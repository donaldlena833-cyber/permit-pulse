import { eq, order } from './supabase.mjs';

export const METROGLASS_TENANT_ID = 'b1d46be5-2eb7-4d5c-8098-15abf581b7d6';
export const METROGLASS_TENANT_SLUG = 'metroglasspro';

function compactText(value) {
  const next = String(value || '').trim();
  return next || null;
}

export function normalizeTenantFeatures(tenant = null) {
  const raw = tenant?.features && typeof tenant.features === 'object' && !Array.isArray(tenant.features)
    ? tenant.features
    : {};

  return {
    permit_scanning: Boolean(raw.permit_scanning || tenant?.permit_scanning_enabled || tenant?.slug === METROGLASS_TENANT_SLUG),
    prospect_outreach: raw.prospect_outreach === undefined ? true : Boolean(raw.prospect_outreach),
  };
}

export function tenantBusinessName(tenant = null) {
  return compactText(tenant?.business_name) || compactText(tenant?.name) || 'Business';
}

export function tenantWebsite(tenant = null) {
  return compactText(tenant?.website) || '';
}

export function tenantWebsiteUrl(tenant = null) {
  const website = tenantWebsite(tenant);
  if (!website) {
    return '';
  }

  if (/^https?:\/\//i.test(website)) {
    return website;
  }

  return `https://${website}`;
}

export function tenantAttachmentFilename(tenant = null) {
  return compactText(tenant?.attachment_filename) || `${tenantBusinessName(tenant)} - About Us.pdf`;
}

export function tenantAttachmentContentType(tenant = null) {
  return compactText(tenant?.attachment_content_type) || 'application/pdf';
}

async function findTenantMapping(db, filters, ordering = []) {
  const candidates = [
    [...filters, eq('status', 'active')],
    filters,
  ];

  for (const candidateFilters of candidates) {
    const row = await db.single('v2_tenant_users', {
      filters: candidateFilters,
      ...(ordering.length > 0 ? { ordering } : {}),
    }).catch(() => null);
    if (row) {
      return row;
    }
  }

  return null;
}

export async function resolveTenant(db, authUser) {
  if (!authUser?.id && !authUser?.email) {
    return null;
  }

  let mapping = null;

  if (authUser?.id) {
    mapping = await findTenantMapping(db, [eq('auth_user_id', authUser.id)]);
  }

  if (!mapping && authUser?.email) {
    mapping = await findTenantMapping(
      db,
      [eq('email', String(authUser.email).toLowerCase())],
      [order('created_at', 'asc')],
    );
  }

  if (!mapping?.tenant_id) {
    return null;
  }

  return db.single('v2_tenants', {
    filters: [eq('id', mapping.tenant_id)],
  });
}

export async function getTenantBySlug(db, slug) {
  return db.single('v2_tenants', {
    filters: [eq('slug', slug)],
  });
}

export async function listTenants(db) {
  return db.select('v2_tenants', {
    ordering: [order('name', 'asc')],
  });
}

export async function getTenantGmailCredential(db, tenantId) {
  if (!tenantId) {
    return null;
  }

  return db.single('v2_tenant_gmail_credentials', {
    filters: [eq('tenant_id', tenantId)],
  }).catch(() => null);
}

export async function getTenantAttachmentStatus(env, tenant) {
  const attachmentKey = compactText(tenant?.attachment_kv_key);
  const filename = tenantAttachmentFilename(tenant);

  if (!env?.PERMIT_PULSE?.get || !attachmentKey) {
    return {
      configured: false,
      loaded: false,
      filename,
      content_type: tenantAttachmentContentType(tenant),
      key: attachmentKey || '',
    };
  }

  const payload = await env.PERMIT_PULSE.get(attachmentKey, 'arrayBuffer');

  return {
    configured: true,
    loaded: Boolean(payload),
    filename,
    content_type: tenantAttachmentContentType(tenant),
    key: attachmentKey,
  };
}

export async function presentTenantProfile(env, db, tenant) {
  const [credential, attachment] = await Promise.all([
    getTenantGmailCredential(db, tenant?.id),
    getTenantAttachmentStatus(env, tenant),
  ]);

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    business_name: tenantBusinessName(tenant),
    website: tenantWebsiteUrl(tenant),
    icon: compactText(tenant.icon) || tenantBusinessName(tenant).slice(0, 2).toUpperCase(),
    accent_color: compactText(tenant.accent_color) || '#334155',
    sender_name: compactText(tenant.sender_name) || 'Team',
    sender_email: compactText(tenant.sender_email) || '',
    phone: compactText(tenant.phone),
    outreach_pitch: compactText(tenant.outreach_pitch) || '',
    outreach_focus: compactText(tenant.outreach_focus) || '',
    outreach_cta: compactText(tenant.outreach_cta) || '',
    features: normalizeTenantFeatures(tenant),
    gmail_connected: Boolean(credential?.refresh_token_encrypted || (tenant.id === METROGLASS_TENANT_ID && env.GMAIL_REFRESH_TOKEN)),
    gmail_address: compactText(credential?.gmail_address) || compactText(tenant.sender_email),
    gmail_token_status: compactText(credential?.token_status) || (tenant.id === METROGLASS_TENANT_ID && env.GMAIL_REFRESH_TOKEN ? 'active' : 'missing'),
    gmail_last_token_refresh_at: credential?.last_token_refresh_at || null,
    attachment_configured: attachment.loaded,
    attachment_filename: attachment.filename,
    attachment_key: attachment.key,
  };
}
