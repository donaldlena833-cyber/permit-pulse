import { appendAuditEvent } from './audit.mjs';
import { createTenantScopedDb } from './tenant-db.mjs';
import { eq } from './supabase.mjs';

function compactText(value) {
  return String(value || '').trim();
}

function assertOwnerBilling(member) {
  if (!member || member.role !== 'owner') {
    throw new Error('Only workspace owners can manage billing');
  }
}

function appUrl(env) {
  return compactText(env?.PERMIT_PULSE_APP_URL || env?.PUBLIC_APP_URL || env?.APP_URL).replace(/\/$/, '');
}

function stripeSecret(env) {
  const key = compactText(env?.STRIPE_SECRET_KEY);
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is required for billing');
  }
  return key;
}

function checkoutPriceId(env) {
  const priceId = compactText(env?.STRIPE_PRICE_ID_STARTER);
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID_STARTER is required for billing checkout');
  }
  return priceId;
}

function urlEncoded(entries = []) {
  const params = new URLSearchParams();

  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.append(key, String(value));
  }

  return params;
}

async function stripeRequest(env, path, options = {}) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecret(env)}`,
      'Content-Type': options.contentType || 'application/x-www-form-urlencoded',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error?.message || `Stripe request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function stripeStatus(status) {
  if (status === 'trialing') return 'trialing';
  if (status === 'active') return 'active';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  return 'past_due';
}

function stripePlanName(price) {
  return compactText(price?.lookup_key || price?.nickname || 'starter') || 'starter';
}

function stripePlanPrice(price, fallback = 9900) {
  return Number(price?.unit_amount || fallback || 9900);
}

async function ensureStripeCustomer(env, rawDb, tenant) {
  if (tenant?.stripe_customer_id) {
    return tenant.stripe_customer_id;
  }

  const customer = await stripeRequest(env, '/v1/customers', {
    body: urlEncoded([
      ['email', tenant.billing_email || tenant.sender_email || ''],
      ['name', tenant.business_name || tenant.name || 'PermitPulse Workspace'],
      ['metadata[tenant_id]', tenant.id],
      ['metadata[workspace_slug]', tenant.slug],
    ]),
  });

  await rawDb.update('v2_tenants', [eq('id', tenant.id)], {
    stripe_customer_id: customer.id,
    billing_email: tenant.billing_email || tenant.sender_email || null,
    updated_at: new Date().toISOString(),
  });

  return customer.id;
}

async function auditBillingEvent(rawDb, tenantId, actorId, eventType, detail) {
  const scopedDb = createTenantScopedDb(rawDb, tenantId);
  await appendAuditEvent(scopedDb, {
    actorType: actorId ? 'user' : 'system',
    actorId: actorId || null,
    eventType,
    targetType: 'billing',
    targetId: tenantId,
    detail,
  });
}

export async function createBillingCheckoutSession(env, rawDb, tenantContext) {
  assertOwnerBilling(tenantContext?.member);

  const customerId = await ensureStripeCustomer(env, rawDb, tenantContext.tenant);
  const baseUrl = appUrl(env);
  if (!baseUrl) {
    throw new Error('PERMIT_PULSE_APP_URL is required for billing redirects');
  }

  const session = await stripeRequest(env, '/v1/checkout/sessions', {
    body: urlEncoded([
      ['mode', 'subscription'],
      ['customer', customerId],
      ['success_url', `${baseUrl}/app/settings?billing=success`],
      ['cancel_url', `${baseUrl}/app/settings?billing=cancelled`],
      ['line_items[0][price]', checkoutPriceId(env)],
      ['line_items[0][quantity]', '1'],
      ['allow_promotion_codes', 'true'],
      ['client_reference_id', tenantContext.tenant.id],
      ['metadata[tenant_id]', tenantContext.tenant.id],
      ['metadata[workspace_slug]', tenantContext.tenant.slug],
    ]),
  });

  await auditBillingEvent(rawDb, tenantContext.tenant.id, tenantContext.member.email, 'billing_checkout_created', {
    stripe_customer_id: customerId,
    stripe_checkout_session_id: session.id,
  });

  return {
    url: session.url,
    session_id: session.id,
  };
}

export async function createBillingPortalSession(env, rawDb, tenantContext) {
  assertOwnerBilling(tenantContext?.member);

  const customerId = await ensureStripeCustomer(env, rawDb, tenantContext.tenant);
  const baseUrl = appUrl(env);
  if (!baseUrl) {
    throw new Error('PERMIT_PULSE_APP_URL is required for billing redirects');
  }

  const session = await stripeRequest(env, '/v1/billing_portal/sessions', {
    body: urlEncoded([
      ['customer', customerId],
      ['return_url', `${baseUrl}/app/settings`],
    ]),
  });

  await auditBillingEvent(rawDb, tenantContext.tenant.id, tenantContext.member.email, 'billing_portal_opened', {
    stripe_customer_id: customerId,
  });

  return {
    url: session.url,
  };
}

function parseStripeSignature(value) {
  const parts = String(value || '').split(',');
  const parsed = { timestamp: '', signatures: [] };

  for (const part of parts) {
    const [key, rawValue] = part.split('=');
    if (key === 't') {
      parsed.timestamp = rawValue || '';
    }
    if (key === 'v1' && rawValue) {
      parsed.signatures.push(rawValue);
    }
  }

  return parsed;
}

function hexToBytes(value) {
  const normalized = compactText(value);
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }

  return result === 0;
}

async function verifyStripeSignature(payload, header, secretValue) {
  const parsed = parseStripeSignature(header);
  if (!parsed.timestamp || parsed.signatures.length === 0) {
    throw new Error('Missing Stripe signature');
  }

  const ageSeconds = Math.abs(Date.now() - (Number(parsed.timestamp) * 1000)) / 1000;
  if (ageSeconds > 300) {
    throw new Error('Stripe signature timestamp is too old');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `${parsed.timestamp}.${payload}`;
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));

  const matches = parsed.signatures.some((signature) => constantTimeEqual(digest, hexToBytes(signature)));
  if (!matches) {
    throw new Error('Stripe signature verification failed');
  }
}

async function findTenantForBillingObject(rawDb, object) {
  const tenantId = compactText(object?.metadata?.tenant_id);
  if (tenantId) {
    return rawDb.single('v2_tenants', {
      filters: [eq('id', tenantId)],
    });
  }

  const customerId = compactText(object?.customer);
  if (customerId) {
    const byCustomer = await rawDb.single('v2_tenants', {
      filters: [eq('stripe_customer_id', customerId)],
    });
    if (byCustomer) {
      return byCustomer;
    }
  }

  const subscriptionId = compactText(object?.subscription || object?.id);
  if (subscriptionId) {
    return rawDb.single('v2_tenants', {
      filters: [eq('stripe_subscription_id', subscriptionId)],
    });
  }

  return null;
}

async function syncTenantFromSubscription(rawDb, tenant, subscription, extra = {}) {
  const price = subscription?.items?.data?.[0]?.price || extra.price || null;
  const patch = {
    stripe_customer_id: compactText(subscription?.customer || extra.customer) || tenant.stripe_customer_id || null,
    stripe_subscription_id: compactText(subscription?.id || extra.subscription) || tenant.stripe_subscription_id || null,
    billing_email: compactText(extra.billing_email) || tenant.billing_email || null,
    subscription_status: stripeStatus(subscription?.status || extra.status || tenant.subscription_status),
    plan_name: stripePlanName(price),
    plan_price_cents: stripePlanPrice(price, tenant.plan_price_cents),
    updated_at: new Date().toISOString(),
  };

  const [updated] = await rawDb.update('v2_tenants', [eq('id', tenant.id)], patch);
  return updated || { ...tenant, ...patch };
}

export async function handleBillingWebhook(request, env, rawDb) {
  const webhookSecret = compactText(env?.STRIPE_WEBHOOK_SECRET);
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for billing webhooks');
  }

  const payload = await request.text();
  await verifyStripeSignature(payload, request.headers.get('Stripe-Signature') || '', webhookSecret);
  const event = JSON.parse(payload);
  const object = event?.data?.object || {};
  const tenant = await findTenantForBillingObject(rawDb, object);

  if (!tenant) {
    return {
      received: true,
      ignored: true,
      type: event?.type || null,
    };
  }

  let detail = { stripe_event_type: event.type };

  if (event.type === 'checkout.session.completed') {
    await syncTenantFromSubscription(rawDb, tenant, {
      id: compactText(object.subscription),
      customer: compactText(object.customer),
      status: 'active',
      items: { data: [] },
    }, {
      customer: compactText(object.customer),
      subscription: compactText(object.subscription),
      billing_email: compactText(object.customer_details?.email || object.customer_email),
    });
    detail = {
      ...detail,
      stripe_customer_id: object.customer || null,
      stripe_subscription_id: object.subscription || null,
    };
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const updatedTenant = await syncTenantFromSubscription(rawDb, tenant, object, {
      billing_email: tenant.billing_email,
    });
    detail = {
      ...detail,
      stripe_customer_id: updatedTenant.stripe_customer_id,
      stripe_subscription_id: updatedTenant.stripe_subscription_id,
      subscription_status: updatedTenant.subscription_status,
    };
  }

  if (event.type === 'invoice.payment_failed') {
    await rawDb.update('v2_tenants', [eq('id', tenant.id)], {
      subscription_status: 'past_due',
      updated_at: new Date().toISOString(),
    });
    detail = {
      ...detail,
      subscription_status: 'past_due',
    };
  }

  await auditBillingEvent(rawDb, tenant.id, null, 'billing_webhook_processed', detail);

  return {
    received: true,
    ignored: false,
    type: event?.type || null,
  };
}
