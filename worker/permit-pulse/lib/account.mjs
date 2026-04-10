import { appendAuditEvent } from './audit.mjs';
import { APP_CONFIG_DEFAULTS } from './config.mjs';
import { encryptText } from './crypto.mjs';
import { createTenantScopedDb } from './tenant-db.mjs';
import { eq, ilike, order } from './supabase.mjs';

const WORKSPACE_DEFAULTS = {
  metroglasspro: {
    phone: '(332) 999-3846',
    outreach_pitch: 'help interior designers and remodelers turn glass scope into clean installs across NYC, New Jersey, and Connecticut',
    outreach_focus: 'We handle shower enclosures, mirrors, partitions, and cabinet glass with quick pricing and clear coordination.',
    outreach_cta: 'If glass is still open on a project, I would be glad to take a look and turn around pricing quickly.',
  },
  lokeil: {
    outreach_pitch: 'help remodeling teams turn glass scope into clean installs without a lot of back and forth',
    outreach_focus: 'We handle shower enclosures, mirrors, partitions, and other custom glass work with quick turnarounds and clear communication.',
    outreach_cta: 'If glass is still part of the job, I would be glad to take a look and help keep it moving.',
  },
};

const LEGACY_WORKSPACE_DEFAULTS = {
  metroglasspro: {
    outreach_pitch: 'help interior designers turn glass concepts into finished installs without the usual back and forth across NYC, New Jersey, and Connecticut',
    outreach_focus: 'We help interior designers translate shower, mirror, partition, and cabinet glass ideas into clean installs without losing the original concept.',
    outreach_cta: 'If you have a project where glass scope still needs a responsive partner, I would be glad to connect, turn around pricing quickly, and help keep things moving.',
  },
};

const GMAIL_CONNECT_STATE_PREFIX = 'workspace_gmail:state:';
const GMAIL_CONNECT_STATE_TTL = 60 * 20;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value) {
  return compactText(value).toLowerCase();
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf('@');
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : '';
}

function normalizeWebsite(value) {
  const normalized = compactText(value);
  if (!normalized) {
    return null;
  }

  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

function websiteDomain(value) {
  try {
    const website = normalizeWebsite(value);
    return website ? new URL(website).hostname.replace(/^www\./i, '').toLowerCase() : '';
  } catch {
    return '';
  }
}

function slugify(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function workspaceDefaults(slug) {
  return WORKSPACE_DEFAULTS[String(slug || '').trim().toLowerCase()] || {};
}

function workspaceLegacyDefaults(slug) {
  return LEGACY_WORKSPACE_DEFAULTS[String(slug || '').trim().toLowerCase()] || {};
}

function hashCode(value) {
  let hash = 0;

  for (const character of String(value || '')) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash);
}

function defaultAccentColor(seed) {
  const palette = ['#B88A52', '#5F7C65', '#305F72', '#8A4F7D', '#7A5C44', '#385D8A'];
  return palette[hashCode(seed) % palette.length];
}

function workspaceIcon(value) {
  const pieces = compactText(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (pieces.length === 0) {
    return 'PP';
  }

  return pieces.map((piece) => piece[0]).join('').toUpperCase();
}

function resolveWorkspaceCopy(value, fallback = null, legacyValues = []) {
  const text = compactText(value);
  if (!text) {
    return fallback || null;
  }

  if (legacyValues.some((legacy) => legacy && text === legacy)) {
    return fallback || text;
  }

  return text;
}

function attachmentStorageKey(slug, filename) {
  const safeFilename = compactText(filename).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment.pdf';
  return `workspace/${slug || 'default'}/attachments/${Date.now()}-${crypto.randomUUID()}-${safeFilename}`;
}

function inviteToken() {
  return crypto.randomUUID();
}

function inviteExpiresAt() {
  return new Date(Date.now() + INVITE_TTL_MS).toISOString();
}

function resolveAppUrl(env) {
  return compactText(env?.PERMIT_PULSE_APP_URL || env?.PUBLIC_APP_URL || env?.APP_URL).replace(/\/$/, '');
}

function resolveWorkerUrl(env) {
  return compactText(env?.PERMIT_PULSE_WORKER_URL || env?.WORKER_URL).replace(/\/$/, '');
}

function resolveGmailRedirectUrl(env, requestOrigin = '') {
  const configured = compactText(env?.GMAIL_REDIRECT_URI);
  if (configured) {
    return configured;
  }

  const workerUrl = resolveWorkerUrl(env) || compactText(requestOrigin).replace(/\/$/, '');
  if (!workerUrl) {
    throw new Error('GMAIL_REDIRECT_URI or PERMIT_PULSE_WORKER_URL is required for Gmail connect');
  }

  return `${workerUrl}/api/account/mailboxes/gmail/callback`;
}

function decodeBase64ToBytes(value) {
  const normalized = String(value || '').trim().replace(/^data:.*;base64,/, '');
  if (!normalized) {
    throw new Error('Attachment file content is required');
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function sanitizeWorkspacePatch(payload = {}) {
  const patch = {};

  if (payload.name !== undefined) {
    const value = compactText(payload.name);
    if (!value) {
      throw new Error('Workspace name is required');
    }
    patch.name = value;
  }

  if (payload.business_name !== undefined) {
    const value = compactText(payload.business_name);
    if (!value) {
      throw new Error('Business name is required');
    }
    patch.business_name = value;
  }

  if (payload.website !== undefined) {
    patch.website = normalizeWebsite(payload.website);
  }

  if (payload.sender_name !== undefined) {
    patch.sender_name = compactText(payload.sender_name) || null;
  }

  if (payload.sender_email !== undefined) {
    const value = normalizeEmail(payload.sender_email);
    if (value && !value.includes('@')) {
      throw new Error('Sender email must be a valid email address');
    }
    patch.sender_email = value || null;
  }

  if (payload.billing_email !== undefined) {
    const value = normalizeEmail(payload.billing_email);
    if (value && !value.includes('@')) {
      throw new Error('Billing email must be a valid email address');
    }
    patch.billing_email = value || null;
  }

  if (payload.phone !== undefined) {
    patch.phone = compactText(payload.phone) || null;
  }

  if (payload.outreach_pitch !== undefined) {
    patch.outreach_pitch = compactText(payload.outreach_pitch) || null;
  }

  if (payload.outreach_focus !== undefined) {
    patch.outreach_focus = compactText(payload.outreach_focus) || null;
  }

  if (payload.outreach_cta !== undefined) {
    patch.outreach_cta = compactText(payload.outreach_cta) || null;
  }

  if (payload.icon !== undefined) {
    patch.icon = compactText(payload.icon).slice(0, 4) || null;
  }

  if (payload.accent_color !== undefined) {
    patch.accent_color = compactText(payload.accent_color) || null;
  }

  return patch;
}

function presentAttachment(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    file_size_bytes: Number(row.file_size_bytes || 0),
    status: row.status,
    is_default: Boolean(row.is_default),
    uploaded_by: row.uploaded_by || null,
    storage_key: row.storage_key,
    archived_at: row.archived_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function presentMailbox(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    display_name: row.display_name || null,
    status: row.status,
    is_default: Boolean(row.is_default),
    connected_by: row.connected_by || null,
    last_synced_at: row.last_synced_at || null,
    last_sent_at: row.last_sent_at || null,
    last_error: row.last_error || null,
    metadata: row.metadata || {},
    archived_at: row.archived_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function presentOnboarding(row, extras = {}) {
  const status = row?.status || 'pending';

  return {
    status,
    business_info_completed: Boolean(row?.business_info_completed_at),
    sender_identity_completed: Boolean(row?.sender_identity_completed_at),
    attachment_completed: Boolean(row?.attachment_completed_at),
    mailbox_completed: Boolean(row?.mailbox_completed_at),
    first_campaign_ready: Boolean(row?.first_campaign_ready_at),
    completed_at: row?.completed_at || null,
    business_info_completed_at: row?.business_info_completed_at || null,
    sender_identity_completed_at: row?.sender_identity_completed_at || null,
    attachment_completed_at: row?.attachment_completed_at || null,
    mailbox_completed_at: row?.mailbox_completed_at || null,
    first_campaign_ready_at: row?.first_campaign_ready_at || null,
    attachment_count: Number(extras.attachment_count || 0),
    mailbox_count: Number(extras.mailbox_count || 0),
    has_default_attachment: Boolean(extras.has_default_attachment),
    has_default_mailbox: Boolean(extras.has_default_mailbox),
  };
}

function isMissingRelationError(error, tableName) {
  const message = String(error?.message || '');
  return message.includes(tableName) && (message.includes('does not exist') || message.includes('relation'));
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || '');
  return message.includes(columnName);
}

function legacyWorkspaceTimestamp(row) {
  return row?.updated_at || row?.created_at || new Date().toISOString();
}

function buildLegacyAttachment(row) {
  const storageKey = compactText(row?.attachment_kv_key);
  const filename = compactText(row?.attachment_filename);

  if (!storageKey && !filename) {
    return null;
  }

  return {
    id: `legacy-attachment:${row.id}`,
    filename: filename || 'About Us.pdf',
    content_type: compactText(row?.attachment_content_type) || 'application/pdf',
    file_size_bytes: 0,
    status: 'active',
    is_default: true,
    uploaded_by: null,
    storage_key: storageKey || `legacy-attachment:${row.id}`,
    archived_at: null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function buildLegacyMailbox(row) {
  const email = normalizeEmail(row?.sender_email);
  if (!email) {
    return null;
  }

  return {
    id: `legacy-mailbox:${row.id}`,
    provider: 'gmail',
    email,
    display_name: compactText(row?.sender_name) || compactText(row?.business_name) || compactText(row?.name) || email,
    status: 'active',
    is_default: true,
    connected_by: null,
    last_synced_at: null,
    last_sent_at: null,
    last_error: null,
    metadata: { legacy: true },
    archived_at: null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function buildLegacyWorkspaceResources(row) {
  const attachment = buildLegacyAttachment(row);
  const mailbox = buildLegacyMailbox(row);
  const timestamp = legacyWorkspaceTimestamp(row);
  const businessReady = Boolean(compactText(row?.name) && compactText(row?.business_name));
  const senderReady = Boolean(compactText(row?.sender_name) && normalizeEmail(row?.sender_email));
  const attachmentReady = Boolean(attachment);
  const mailboxReady = Boolean(mailbox);
  const firstCampaignReady = Boolean(businessReady && senderReady && attachmentReady && mailboxReady);

  return {
    attachments: attachment ? [attachment] : [],
    defaultAttachment: attachment,
    mailboxes: mailbox ? [mailbox] : [],
    defaultMailbox: mailbox,
    onboarding: presentOnboarding({
      status: firstCampaignReady ? 'completed' : 'in_progress',
      business_info_completed_at: businessReady ? timestamp : null,
      sender_identity_completed_at: senderReady ? timestamp : null,
      attachment_completed_at: attachmentReady ? timestamp : null,
      mailbox_completed_at: mailboxReady ? timestamp : null,
      first_campaign_ready_at: firstCampaignReady ? timestamp : null,
      completed_at: firstCampaignReady ? timestamp : null,
    }, {
      attachment_count: attachmentReady ? 1 : 0,
      mailbox_count: mailboxReady ? 1 : 0,
      has_default_attachment: attachmentReady,
      has_default_mailbox: mailboxReady,
    }),
  };
}

function presentMember(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name || null,
    role: row.role,
    status: row.status,
    can_manage_billing: Boolean(row.can_manage_billing),
    invited_at: row.invited_at || null,
    invite_expires_at: row.invite_expires_at || null,
    accepted_at: row.accepted_at || null,
    disabled_at: row.disabled_at || null,
  };
}

function resolveWorkspaceAccount(row) {
  if (!row) {
    return null;
  }

  const defaults = workspaceDefaults(row.slug);
  const legacyDefaults = workspaceLegacyDefaults(row.slug);
  const defaultAttachment = row.default_attachment || null;
  const defaultMailbox = row.default_mailbox || null;

  return {
    ...row,
    website: row.website || null,
    sender_name: row.sender_name || null,
    sender_email: defaultMailbox?.email || row.sender_email || null,
    billing_email: row.billing_email || row.sender_email || null,
    phone: row.phone || defaults.phone || null,
    attachment_filename: defaultAttachment?.filename || row.attachment_filename || null,
    attachment_kv_key: defaultAttachment?.storage_key || row.attachment_kv_key || null,
    attachment_content_type: defaultAttachment?.content_type || row.attachment_content_type || 'application/pdf',
    outreach_pitch: resolveWorkspaceCopy(row.outreach_pitch, defaults.outreach_pitch || null, legacyDefaults.outreach_pitch ? [legacyDefaults.outreach_pitch] : []),
    outreach_focus: resolveWorkspaceCopy(row.outreach_focus, defaults.outreach_focus || null, legacyDefaults.outreach_focus ? [legacyDefaults.outreach_focus] : []),
    outreach_cta: resolveWorkspaceCopy(row.outreach_cta, defaults.outreach_cta || null, legacyDefaults.outreach_cta ? [legacyDefaults.outreach_cta] : []),
    icon: row.icon || workspaceIcon(row.business_name || row.name),
    accent_color: row.accent_color || defaultAccentColor(row.slug || row.name),
    onboarding: row.onboarding || null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    default_attachment: defaultAttachment,
    mailboxes: Array.isArray(row.mailboxes) ? row.mailboxes : [],
    default_mailbox: defaultMailbox,
  };
}

function presentTenant(row) {
  const resolved = resolveWorkspaceAccount(row);
  if (!resolved) {
    return null;
  }

  return {
    id: resolved.id,
    slug: resolved.slug,
    name: resolved.name,
    business_name: resolved.business_name,
    website: resolved.website,
    primary_login_domain: resolved.primary_login_domain,
    icon: resolved.icon || null,
    accent_color: resolved.accent_color || null,
    sender_name: resolved.sender_name,
    sender_email: resolved.sender_email,
    billing_email: resolved.billing_email || null,
    phone: resolved.phone || null,
    attachment_filename: resolved.attachment_filename || null,
    plan_name: resolved.plan_name,
    plan_price_cents: Number(resolved.plan_price_cents || 0),
    subscription_status: resolved.subscription_status,
    stripe_customer_id: resolved.stripe_customer_id || null,
    stripe_subscription_id: resolved.stripe_subscription_id || null,
    onboarding_status: resolved.onboarding?.status || resolved.onboarding_status || 'pending',
    outreach_pitch: resolved.outreach_pitch || null,
    outreach_focus: resolved.outreach_focus || null,
    outreach_cta: resolved.outreach_cta || null,
    default_attachment: resolved.default_attachment || null,
    default_mailbox: resolved.default_mailbox || null,
    brand: {
      icon: resolved.icon || null,
      accent_color: resolved.accent_color || null,
    },
  };
}

async function listMembers(rawDb, tenantId) {
  const rows = await rawDb.select('v2_tenant_users', {
    filters: [eq('tenant_id', tenantId)],
    ordering: [order('created_at', 'asc')],
  });

  return rows.map(presentMember);
}

async function listAttachments(rawDb, tenantId, options = {}) {
  const filters = [eq('tenant_id', tenantId)];

  if (!options.includeArchived) {
    filters.push(eq('status', 'active'));
  }

  try {
    const rows = await rawDb.select('v2_workspace_attachments', {
      filters,
      ordering: [order('is_default', 'desc'), order('created_at', 'desc')],
    });

    return rows.map(presentAttachment);
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_workspace_attachments')) {
      throw error;
    }

    return [];
  }
}

async function listMailboxes(rawDb, tenantId, options = {}) {
  const filters = [eq('tenant_id', tenantId)];

  if (!options.includeArchived) {
    filters.push(eq('status', 'active'));
  }

  try {
    const rows = await rawDb.select('v2_workspace_mailboxes', {
      filters,
      ordering: [order('is_default', 'desc'), order('created_at', 'desc')],
    });

    return rows.map(presentMailbox);
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_workspace_mailboxes')) {
      throw error;
    }

    return [];
  }
}

async function getOnboardingRow(rawDb, tenantId) {
  try {
    return await rawDb.single('v2_workspace_onboarding', {
      filters: [eq('tenant_id', tenantId)],
    });
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_workspace_onboarding')) {
      throw error;
    }

    return null;
  }
}

async function getWorkspaceResources(rawDb, tenantId) {
  const [attachments, mailboxes, onboardingRow] = await Promise.all([
    listAttachments(rawDb, tenantId, { includeArchived: true }),
    listMailboxes(rawDb, tenantId, { includeArchived: true }),
    getOnboardingRow(rawDb, tenantId),
  ]);

  const activeAttachments = attachments.filter((row) => row.status === 'active' && !row.archived_at);
  const activeMailboxes = mailboxes.filter((row) => row.status === 'active' && !row.archived_at);
  const defaultAttachment = activeAttachments.find((row) => row.is_default) || activeAttachments[0] || null;
  const defaultMailbox = activeMailboxes.find((row) => row.is_default) || activeMailboxes[0] || null;

  return {
    attachments,
    defaultAttachment,
    mailboxes,
    defaultMailbox,
    onboarding: onboardingRow ? presentOnboarding(onboardingRow, {
      attachment_count: activeAttachments.length,
      mailbox_count: activeMailboxes.length,
      has_default_attachment: Boolean(defaultAttachment),
      has_default_mailbox: Boolean(defaultMailbox),
    }) : null,
  };
}

async function hydrateTenant(rawDb, row) {
  if (!row) {
    return null;
  }

  const resources = await getWorkspaceResources(rawDb, row.id);
  const legacyResources = buildLegacyWorkspaceResources(row);
  const mergedResources = {
    attachments: resources.attachments.length > 0 ? resources.attachments : legacyResources.attachments,
    defaultAttachment: resources.defaultAttachment || legacyResources.defaultAttachment,
    mailboxes: resources.mailboxes.length > 0 ? resources.mailboxes : legacyResources.mailboxes,
    defaultMailbox: resources.defaultMailbox || legacyResources.defaultMailbox,
    onboarding: resources.onboarding?.status ? resources.onboarding : legacyResources.onboarding,
  };
  return resolveWorkspaceAccount({
    ...row,
    attachments: mergedResources.attachments,
    default_attachment: mergedResources.defaultAttachment,
    mailboxes: mergedResources.mailboxes,
    default_mailbox: mergedResources.defaultMailbox,
    onboarding: mergedResources.onboarding,
  });
}

async function ensureUniqueSlug(rawDb, baseSlug) {
  const seed = slugify(baseSlug) || 'workspace';
  const rows = await rawDb.select('v2_tenants', {
    columns: 'slug',
    filters: [ilike('slug', `${seed}%`)],
    limit: 50,
  });
  const used = new Set(rows.map((row) => String(row.slug || '')));

  if (!used.has(seed)) {
    return seed;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${seed}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not generate a unique workspace slug');
}

async function assertPrimaryDomainAvailable(rawDb, domain, existingTenantId = null) {
  if (!domain) {
    throw new Error('A workspace login domain could not be derived');
  }

  const existing = await rawDb.single('v2_tenants', {
    filters: [eq('primary_login_domain', domain)],
  });

  if (existing && String(existing.id) !== String(existingTenantId || '')) {
    throw new Error('A workspace already exists for this email or website domain');
  }
}

async function seedTenantConfig(rawDb, tenantId) {
  const rows = Object.entries(APP_CONFIG_DEFAULTS).map(([key, value]) => ({
    tenant_id: tenantId,
    key,
    value,
  }));

  try {
    await rawDb.upsert('v2_tenant_app_config', rows, 'tenant_id,key');
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_tenant_app_config')) {
      throw error;
    }

    await rawDb.upsert('v2_app_config', rows.map(({ key, value }) => ({ key, value })), 'key');
  }
}

function onboardingPatchFromState(tenant, current, resources, manual = {}) {
  const now = new Date().toISOString();
  const businessReady = Boolean(compactText(tenant?.business_name) && tenant?.website);
  const senderReady = Boolean(compactText(tenant?.sender_name) && normalizeEmail(tenant?.sender_email));
  const attachmentReady = Boolean(resources?.defaultAttachment);
  const mailboxReady = Boolean(resources?.defaultMailbox);
  const firstCampaignReady = Boolean(manual.first_campaign_ready || current?.first_campaign_ready_at);

  const patch = {
    status: businessReady || senderReady || attachmentReady || mailboxReady || firstCampaignReady ? 'in_progress' : 'pending',
    updated_at: now,
    business_info_completed_at: current?.business_info_completed_at || (businessReady ? now : null),
    sender_identity_completed_at: current?.sender_identity_completed_at || (senderReady ? now : null),
    attachment_completed_at: current?.attachment_completed_at || (attachmentReady ? now : null),
    mailbox_completed_at: current?.mailbox_completed_at || (mailboxReady ? now : null),
    first_campaign_ready_at: current?.first_campaign_ready_at || (firstCampaignReady ? now : null),
    completed_at: current?.completed_at || null,
  };

  if (
    patch.business_info_completed_at
    && patch.sender_identity_completed_at
    && patch.attachment_completed_at
    && patch.mailbox_completed_at
    && patch.first_campaign_ready_at
  ) {
    patch.status = 'completed';
    patch.completed_at = patch.completed_at || now;
  }

  return patch;
}

async function syncOnboarding(rawDb, tenantId, manual = {}) {
  const tenant = await rawDb.single('v2_tenants', {
    filters: [eq('id', tenantId)],
  });
  const current = await getOnboardingRow(rawDb, tenantId);
  const resources = await getWorkspaceResources(rawDb, tenantId);
  const legacyResources = buildLegacyWorkspaceResources(tenant || {});
  const resolvedResources = {
    attachments: resources.attachments.length > 0 ? resources.attachments : legacyResources.attachments,
    defaultAttachment: resources.defaultAttachment || legacyResources.defaultAttachment,
    mailboxes: resources.mailboxes.length > 0 ? resources.mailboxes : legacyResources.mailboxes,
    defaultMailbox: resources.defaultMailbox || legacyResources.defaultMailbox,
    onboarding: resources.onboarding?.status ? resources.onboarding : legacyResources.onboarding,
  };
  const patch = onboardingPatchFromState(tenant, current, resolvedResources, manual);

  let row = null;
  try {
    [row] = await rawDb.upsert('v2_workspace_onboarding', {
      tenant_id: tenantId,
      status: patch.status,
      business_info_completed_at: patch.business_info_completed_at,
      sender_identity_completed_at: patch.sender_identity_completed_at,
      attachment_completed_at: patch.attachment_completed_at,
      mailbox_completed_at: patch.mailbox_completed_at,
      first_campaign_ready_at: patch.first_campaign_ready_at,
      completed_at: patch.completed_at,
      updated_at: patch.updated_at,
    }, 'tenant_id');
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_workspace_onboarding')) {
      throw error;
    }
  }

  try {
    await rawDb.update('v2_tenants', [eq('id', tenantId)], {
      onboarding_status: patch.status,
      onboarding_completed_at: patch.completed_at,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (!isMissingColumnError(error, 'onboarding_status') && !isMissingColumnError(error, 'onboarding_completed_at')) {
      throw error;
    }
  }

  return presentOnboarding(row || patch, {
    attachment_count: resolvedResources.attachments.filter((item) => item.status === 'active' && !item.archived_at).length,
    mailbox_count: resolvedResources.mailboxes.filter((item) => item.status === 'active' && !item.archived_at).length,
    has_default_attachment: Boolean(resolvedResources.defaultAttachment),
    has_default_mailbox: Boolean(resolvedResources.defaultMailbox),
  });
}

async function bindActiveMembership(rawDb, member, user) {
  const authUserId = compactText(user?.id);

  if (!member || member.status !== 'active') {
    return member;
  }

  if (!member.auth_user_id && authUserId) {
    const patch = {
      auth_user_id: authUserId,
      full_name: member.full_name || compactText(user?.user_metadata?.full_name) || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const [updated] = await rawDb.update('v2_tenant_users', [eq('id', member.id)], {
        ...patch,
        accepted_at: member.accepted_at || new Date().toISOString(),
      });
      return updated || { ...member, auth_user_id: authUserId };
    } catch (error) {
      if (!isMissingColumnError(error, 'accepted_at')) {
        throw error;
      }
      const [updated] = await rawDb.update('v2_tenant_users', [eq('id', member.id)], patch);
      return updated || { ...member, auth_user_id: authUserId };
    }
  }

  return member;
}

async function supabaseAdminRequest(env, path, options = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for workspace invites');
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || `Supabase admin request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function tryGenerateSupabaseInvite(env, email, redirectTo, data = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const generated = await supabaseAdminRequest(env, '/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'invite',
        email,
        options: {
          redirectTo,
          data,
        },
      }),
    });
    return generated?.properties?.action_link || generated?.action_link || null;
  } catch {
    try {
      await supabaseAdminRequest(env, `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          data,
        }),
      });
    } catch {
      return null;
    }
  }

  return null;
}

async function storeConnectState(env, stateValue, payload) {
  if (!env.PERMIT_PULSE?.put) {
    throw new Error('KV storage is required for Gmail mailbox connect');
  }

  await env.PERMIT_PULSE.put(`${GMAIL_CONNECT_STATE_PREFIX}${stateValue}`, JSON.stringify(payload), {
    expirationTtl: GMAIL_CONNECT_STATE_TTL,
  });
}

async function readConnectState(env, stateValue) {
  if (!env.PERMIT_PULSE?.get) {
    return null;
  }

  const value = await env.PERMIT_PULSE.get(`${GMAIL_CONNECT_STATE_PREFIX}${stateValue}`);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function clearConnectState(env, stateValue) {
  if (!env.PERMIT_PULSE?.delete) {
    return;
  }

  await env.PERMIT_PULSE.delete(`${GMAIL_CONNECT_STATE_PREFIX}${stateValue}`);
}

async function fetchGmailAccessToken(env, code, redirectUrl) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GMAIL_CLIENT_ID || '',
      client_secret: env.GMAIL_CLIENT_SECRET || '',
      redirect_uri: redirectUrl,
      grant_type: 'authorization_code',
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.error || `Gmail token exchange failed with ${response.status}`);
  }

  return payload;
}

async function fetchGmailProfile(accessToken) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gmail profile lookup failed with ${response.status}`);
  }

  return payload;
}

async function setDefaultAttachment(rawDb, tenantId, attachmentId) {
  await rawDb.update('v2_workspace_attachments', [eq('tenant_id', tenantId)], {
    is_default: false,
    updated_at: new Date().toISOString(),
  });

  const [attachment] = await rawDb.update('v2_workspace_attachments', [eq('id', attachmentId), eq('tenant_id', tenantId)], {
    is_default: true,
    updated_at: new Date().toISOString(),
  });

  return presentAttachment(attachment);
}

async function setDefaultMailbox(rawDb, tenantId, mailboxId) {
  await rawDb.update('v2_workspace_mailboxes', [eq('tenant_id', tenantId)], {
    is_default: false,
    updated_at: new Date().toISOString(),
  });

  const [mailbox] = await rawDb.update('v2_workspace_mailboxes', [eq('id', mailboxId), eq('tenant_id', tenantId)], {
    is_default: true,
    status: 'active',
    archived_at: null,
    updated_at: new Date().toISOString(),
  });

  return presentMailbox(mailbox);
}

function assertWorkspaceManager(member) {
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    throw new Error('Only workspace owners and admins can manage this workspace');
  }
}

function assertOwner(member) {
  if (!member || member.role !== 'owner') {
    throw new Error('Only workspace owners can perform this action');
  }
}

function assertInviteStillValid(member) {
  if (!member || member.status !== 'invited') {
    throw new Error('Invite not found');
  }

  if (member.invite_expires_at && new Date(member.invite_expires_at).getTime() < Date.now()) {
    throw new Error('Invite has expired');
  }
}

export function canManageWorkspace(member) {
  return Boolean(member && (member.role === 'owner' || member.role === 'admin'));
}

export function canManageBilling(member) {
  return Boolean(member && member.role === 'owner');
}

export async function listActiveTenants(rawDb) {
  const rows = await rawDb.select('v2_tenants', {
    filters: [`subscription_status=in.("trialing","active")`],
    ordering: [order('created_at', 'asc')],
    limit: 100,
  });

  return Promise.all(rows.map((row) => hydrateTenant(rawDb, row)));
}

export async function resolveTenantContext(rawDb, user) {
  const authUserId = compactText(user?.id);
  const email = normalizeEmail(user?.email);

  if (!email) {
    return null;
  }

  let member = authUserId
    ? await rawDb.single('v2_tenant_users', {
        filters: [eq('auth_user_id', authUserId)],
      })
    : null;

  if (!member) {
    member = await rawDb.single('v2_tenant_users', {
      filters: [eq('email', email)],
    });
  }

  if (!member || member.status !== 'active') {
    return null;
  }

  member = await bindActiveMembership(rawDb, member, user);

  const tenantRow = await rawDb.single('v2_tenants', {
    filters: [eq('id', member.tenant_id)],
  });

  if (!tenantRow) {
    return null;
  }

  const tenant = await hydrateTenant(rawDb, tenantRow);
  const members = await listMembers(rawDb, tenant.id);

  return {
    tenant,
    member,
    members,
    onboarding: tenant.onboarding || null,
    attachments: tenant.attachments || [],
    mailboxes: tenant.mailboxes || [],
    presentedTenant: presentTenant(tenant),
    presentedMember: presentMember(member),
  };
}

export async function getOnboardingState(rawDb, user) {
  const tenantContext = await resolveTenantContext(rawDb, user);
  if (!tenantContext) {
    return {
      requires_bootstrap: true,
      email: normalizeEmail(user?.email),
      suggested_slug: slugify(user?.user_metadata?.company || getEmailDomain(user?.email) || 'workspace'),
    };
  }

  return {
    requires_bootstrap: false,
    account: tenantContext.presentedTenant,
    current_member: tenantContext.presentedMember,
    onboarding: tenantContext.onboarding,
    attachments: tenantContext.attachments,
    mailboxes: tenantContext.mailboxes,
  };
}

export async function bootstrapWorkspaceOwner(rawDb, user, payload = {}) {
  const email = normalizeEmail(user?.email);
  const authUserId = compactText(user?.id);

  if (!email || !authUserId) {
    throw new Error('You must be signed in to create a workspace');
  }

  const existingByAuth = await rawDb.single('v2_tenant_users', {
    filters: [eq('auth_user_id', authUserId)],
  });
  if (existingByAuth) {
    const tenantContext = await resolveTenantContext(rawDb, user);
    if (tenantContext) {
      return tenantContext;
    }
    throw new Error('This user already belongs to a workspace');
  }

  const existingByEmail = await rawDb.single('v2_tenant_users', {
    filters: [eq('email', email)],
  });
  if (existingByEmail) {
    throw new Error('This email already belongs to a workspace. Use your invite instead.');
  }

  const businessName = compactText(payload.business_name || payload.name);
  if (!businessName) {
    throw new Error('Business name is required');
  }

  const name = compactText(payload.name || businessName);
  const slug = await ensureUniqueSlug(rawDb, payload.slug || businessName);
  const derivedDomain = websiteDomain(payload.website) || getEmailDomain(email);
  await assertPrimaryDomainAvailable(rawDb, derivedDomain);

  const now = new Date().toISOString();
  const [tenantRow] = await rawDb.insert('v2_tenants', {
    slug,
    name,
    business_name: businessName,
    website: normalizeWebsite(payload.website),
    primary_login_domain: derivedDomain,
    icon: workspaceIcon(businessName),
    accent_color: compactText(payload.accent_color) || defaultAccentColor(slug),
    sender_name: compactText(payload.sender_name || user?.user_metadata?.full_name || businessName) || businessName,
    sender_email: normalizeEmail(payload.sender_email || email),
    billing_email: normalizeEmail(payload.billing_email || email),
    phone: compactText(payload.phone) || workspaceDefaults(slug).phone || null,
    outreach_pitch: compactText(payload.outreach_pitch) || workspaceDefaults(slug).outreach_pitch || null,
    outreach_focus: compactText(payload.outreach_focus) || workspaceDefaults(slug).outreach_focus || null,
    outreach_cta: compactText(payload.outreach_cta) || workspaceDefaults(slug).outreach_cta || null,
    plan_name: 'starter',
    plan_price_cents: Number(payload.plan_price_cents || 9900),
    subscription_status: 'trialing',
    updated_at: now,
  });

  const ownerMember = {
    tenant_id: tenantRow.id,
    auth_user_id: authUserId,
    email,
    full_name: compactText(payload.full_name || user?.user_metadata?.full_name) || null,
    role: 'owner',
    status: 'active',
    can_manage_billing: true,
    updated_at: now,
  };

  try {
    await rawDb.insert('v2_tenant_users', {
      ...ownerMember,
      accepted_at: now,
    });
  } catch (error) {
    if (!isMissingColumnError(error, 'accepted_at')) {
      throw error;
    }
    await rawDb.insert('v2_tenant_users', ownerMember);
  }

  await seedTenantConfig(rawDb, tenantRow.id);
  try {
    await rawDb.upsert('v2_workspace_onboarding', {
      tenant_id: tenantRow.id,
      status: 'in_progress',
      created_by: email,
      updated_by: email,
      created_at: now,
      updated_at: now,
    }, 'tenant_id');
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_workspace_onboarding')) {
      throw error;
    }
  }

  const scopedDb = createTenantScopedDb(rawDb, tenantRow.id);
  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: email,
    eventType: 'workspace_bootstrapped',
    targetType: 'tenant',
    targetId: tenantRow.id,
    detail: {
      business_name: businessName,
      slug,
      onboarding_status: 'in_progress',
    },
  });

  await syncOnboarding(rawDb, tenantRow.id);

  return resolveTenantContext(rawDb, user);
}

export async function updateWorkspaceAccount(rawDb, tenantContext, payload, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);

  const patch = sanitizeWorkspacePatch(payload);
  if (Object.keys(patch).length === 0) {
    return {
      account: tenantContext.presentedTenant,
      onboarding: tenantContext.onboarding,
    };
  }

  patch.updated_at = new Date().toISOString();

  const [tenantRow] = await rawDb.update('v2_tenants', [eq('id', tenantContext.tenant.id)], patch);
  const onboarding = await syncOnboarding(rawDb, tenantContext.tenant.id, {
    first_campaign_ready: Boolean(payload.first_campaign_ready),
  });
  const tenant = await hydrateTenant(rawDb, tenantRow || { ...tenantContext.tenant, ...patch, onboarding });
  const scopedDb = createTenantScopedDb(rawDb, tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'workspace_profile_updated',
    targetType: 'tenant',
    targetId: tenant.id,
    detail: patch,
  });

  return {
    account: presentTenant(tenant),
    onboarding,
  };
}

export async function updateOnboardingProfile(rawDb, tenantContext, payload, actorId = null) {
  const result = await updateWorkspaceAccount(rawDb, tenantContext, payload, actorId);
  return {
    ...result,
    onboarding: await syncOnboarding(rawDb, tenantContext.tenant.id, {
      first_campaign_ready: Boolean(payload.first_campaign_ready),
    }),
  };
}

export async function listWorkspaceAttachments(rawDb, tenantContext) {
  assertWorkspaceManager(tenantContext?.member);
  const attachments = await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true })
    .catch((error) => {
      if (!isMissingRelationError(error, 'v2_workspace_attachments')) {
        throw error;
      }
      return tenantContext.attachments || [];
    });
  return {
    attachments,
    default_attachment: attachments.find((item) => item.is_default && item.status === 'active') || null,
  };
}

export async function uploadWorkspaceAttachment(env, rawDb, tenantContext, payload, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);

  if (!env.PERMIT_PULSE?.put) {
    throw new Error('KV storage is not configured for workspace attachments');
  }

  const filename = compactText(payload?.filename);
  const contentType = compactText(payload?.content_type || payload?.contentType || 'application/pdf') || 'application/pdf';
  if (!filename) {
    throw new Error('Attachment filename is required');
  }
  if (!contentType.toLowerCase().includes('pdf')) {
    throw new Error('Only PDF attachments are supported right now');
  }

  const bytes = decodeBase64ToBytes(payload?.content_base64 || payload?.contentBase64);
  if (bytes.byteLength === 0) {
    throw new Error('Attachment file is empty');
  }
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error('Attachment file must be 5 MB or smaller');
  }

  const storageKey = attachmentStorageKey(tenantContext.tenant.slug, filename);
  await env.PERMIT_PULSE.put(storageKey, bytes, {
    metadata: {
      tenant_id: tenantContext.tenant.id,
      tenant_slug: tenantContext.tenant.slug,
      filename,
      content_type: contentType,
    },
  });

  const existing = await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true });
  const shouldMakeDefault = payload?.make_default !== false;
  const hadDefault = existing.some((item) => item.status === 'active' && item.is_default);
  const [inserted] = await rawDb.insert('v2_workspace_attachments', {
    tenant_id: tenantContext.tenant.id,
    storage_key: storageKey,
    filename,
    content_type: contentType,
    file_size_bytes: bytes.byteLength,
    uploaded_by: actorId || tenantContext.member.email,
    status: 'active',
    is_default: shouldMakeDefault || !hadDefault,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (shouldMakeDefault || !hadDefault) {
    await setDefaultAttachment(rawDb, tenantContext.tenant.id, inserted.id);
  }

  if ((shouldMakeDefault || !hadDefault) && payload?.archive_previous_default) {
    const previousDefault = existing.find((item) => item.is_default && item.status === 'active');
    if (previousDefault) {
      await rawDb.update('v2_workspace_attachments', [eq('id', previousDefault.id), eq('tenant_id', tenantContext.tenant.id)], {
        status: 'archived',
        is_default: false,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  const onboarding = await syncOnboarding(rawDb, tenantContext.tenant.id);
  const attachments = await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true });
  const defaultAttachment = attachments.find((item) => item.is_default && item.status === 'active') || null;
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'attachment_uploaded',
    targetType: 'workspace_attachment',
    targetId: inserted.id,
    detail: {
      filename,
      file_size_bytes: bytes.byteLength,
      is_default: Boolean(defaultAttachment?.id === inserted.id),
      archived_previous_default: Boolean(payload?.archive_previous_default),
    },
  });

  return {
    attachments,
    default_attachment: defaultAttachment,
    onboarding,
  };
}

export async function setWorkspaceAttachmentDefault(rawDb, tenantContext, attachmentId, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);
  const attachment = await rawDb.single('v2_workspace_attachments', {
    filters: [eq('id', attachmentId), eq('tenant_id', tenantContext.tenant.id)],
  });

  if (!attachment || attachment.status !== 'active') {
    throw new Error('Attachment not found');
  }

  const defaultAttachment = await setDefaultAttachment(rawDb, tenantContext.tenant.id, attachmentId);
  const onboarding = await syncOnboarding(rawDb, tenantContext.tenant.id);
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'attachment_set_default',
    targetType: 'workspace_attachment',
    targetId: attachmentId,
    detail: {
      filename: attachment.filename,
    },
  });

  return {
    default_attachment: defaultAttachment,
    attachments: await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true }),
    onboarding,
  };
}

export async function archiveWorkspaceAttachment(rawDb, tenantContext, attachmentId, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);
  const attachment = await rawDb.single('v2_workspace_attachments', {
    filters: [eq('id', attachmentId), eq('tenant_id', tenantContext.tenant.id)],
  });

  if (!attachment) {
    throw new Error('Attachment not found');
  }

  await rawDb.update('v2_workspace_attachments', [eq('id', attachmentId), eq('tenant_id', tenantContext.tenant.id)], {
    status: 'archived',
    is_default: false,
    archived_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const remaining = await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true });
  const active = remaining.filter((item) => item.status === 'active' && !item.archived_at);

  if (attachment.is_default && active.length > 0) {
    await setDefaultAttachment(rawDb, tenantContext.tenant.id, active[0].id);
  }

  const onboarding = await syncOnboarding(rawDb, tenantContext.tenant.id);
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'attachment_archived',
    targetType: 'workspace_attachment',
    targetId: attachmentId,
    detail: {
      filename: attachment.filename,
    },
  });

  const attachments = await listAttachments(rawDb, tenantContext.tenant.id, { includeArchived: true });
  return {
    attachments,
    default_attachment: attachments.find((item) => item.is_default && item.status === 'active') || null,
    onboarding,
  };
}

export async function listWorkspaceMailboxes(rawDb, tenantContext) {
  assertWorkspaceManager(tenantContext?.member);
  const mailboxes = await listMailboxes(rawDb, tenantContext.tenant.id, { includeArchived: true })
    .catch((error) => {
      if (!isMissingRelationError(error, 'v2_workspace_mailboxes')) {
        throw error;
      }
      return tenantContext.mailboxes || [];
    });
  return {
    mailboxes,
    default_mailbox: mailboxes.find((item) => item.is_default && item.status === 'active') || null,
  };
}

export async function beginGmailMailboxConnect(env, tenantContext, options = {}) {
  assertWorkspaceManager(tenantContext?.member);

  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) {
    throw new Error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required for Gmail connect');
  }

  const state = crypto.randomUUID();
  const redirectPath = compactText(options.redirect_path) || '/app/settings';
  const requestOrigin = compactText(options.request_origin);
  const redirectUrl = resolveGmailRedirectUrl(env, requestOrigin);
  await storeConnectState(env, state, {
    tenant_id: tenantContext.tenant.id,
    member_email: tenantContext.member.email,
    redirect_path: redirectPath,
    redirect_url: redirectUrl,
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GMAIL_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ].join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('login_hint', tenantContext.tenant.sender_email || tenantContext.member.email);

  return {
    authorization_url: authUrl.toString(),
  };
}

export async function completeGmailMailboxConnect(env, rawDb, payload = {}) {
  const state = compactText(payload.state);
  const code = compactText(payload.code);
  const authError = compactText(payload.error);

  if (!state) {
    throw new Error('Missing Gmail connect state');
  }

  const storedState = await readConnectState(env, state);
  if (!storedState) {
    throw new Error('Gmail connect session expired. Start again from settings.');
  }

  await clearConnectState(env, state);

  if (authError) {
    throw new Error(authError);
  }

  if (!code) {
    throw new Error('Missing Gmail authorization code');
  }

  const tokenPayload = await fetchGmailAccessToken(env, code, storedState.redirect_url);
  const refreshToken = compactText(tokenPayload.refresh_token);
  if (!refreshToken) {
    throw new Error('Google did not return a refresh token. Retry and choose the consent screen again.');
  }

  const profile = await fetchGmailProfile(tokenPayload.access_token);
  const email = normalizeEmail(profile?.emailAddress);
  if (!email) {
    throw new Error('Could not determine the connected Gmail address');
  }

  const encryptedRefreshToken = await encryptText(env, refreshToken);
  const tenantId = storedState.tenant_id;
  const now = new Date().toISOString();
  const existing = await rawDb.single('v2_workspace_mailboxes', {
    filters: [eq('tenant_id', tenantId), eq('provider', 'gmail'), eq('email', email)],
  });

  let mailbox = null;
  if (existing) {
    const [updated] = await rawDb.update('v2_workspace_mailboxes', [eq('id', existing.id), eq('tenant_id', tenantId)], {
      encrypted_refresh_token: encryptedRefreshToken,
      display_name: existing.display_name || email,
      status: 'active',
      archived_at: null,
      last_error: null,
      metadata: {
        scope: tokenPayload.scope || null,
        token_type: tokenPayload.token_type || null,
      },
      updated_at: now,
    });
    mailbox = updated || existing;
  } else {
    const [inserted] = await rawDb.insert('v2_workspace_mailboxes', {
      tenant_id: tenantId,
      provider: 'gmail',
      email,
      display_name: email,
      encrypted_refresh_token: encryptedRefreshToken,
      status: 'active',
      is_default: true,
      connected_by: storedState.member_email || null,
      metadata: {
        scope: tokenPayload.scope || null,
        token_type: tokenPayload.token_type || null,
      },
      created_at: now,
      updated_at: now,
    });
    mailbox = inserted;
  }

  const presentedMailbox = await setDefaultMailbox(rawDb, tenantId, mailbox.id);
  const [tenantRow] = await rawDb.update('v2_tenants', [eq('id', tenantId)], {
    sender_email: email,
    updated_at: now,
  });
  const onboarding = await syncOnboarding(rawDb, tenantId);
  const scopedDb = createTenantScopedDb(rawDb, tenantId);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: storedState.member_email || null,
    eventType: 'mailbox_connected',
    targetType: 'workspace_mailbox',
    targetId: mailbox.id,
    detail: {
      provider: 'gmail',
      email,
    },
  });

  return {
    redirect_path: storedState.redirect_path || '/app/settings',
    account: presentTenant(await hydrateTenant(rawDb, tenantRow || await rawDb.single('v2_tenants', {
      filters: [eq('id', tenantId)],
    }))),
    default_mailbox: presentedMailbox,
    onboarding,
  };
}

export async function getWorkspaceInvite(rawDb, inviteTokenValue) {
  const member = await rawDb.single('v2_tenant_users', {
    filters: [eq('invite_token', inviteTokenValue)],
  });
  assertInviteStillValid(member);

  const tenant = await rawDb.single('v2_tenants', {
    filters: [eq('id', member.tenant_id)],
  });

  return {
    invite: {
      token: inviteTokenValue,
      email: member.email,
      full_name: member.full_name || null,
      role: member.role,
      status: member.status,
      invite_expires_at: member.invite_expires_at,
    },
    account: presentTenant(await hydrateTenant(rawDb, tenant)),
  };
}

export async function acceptWorkspaceInvite(rawDb, user, inviteTokenValue) {
  const authUserId = compactText(user?.id);
  const email = normalizeEmail(user?.email);

  if (!authUserId || !email) {
    throw new Error('You must be signed in to accept an invite');
  }

  const member = await rawDb.single('v2_tenant_users', {
    filters: [eq('invite_token', inviteTokenValue)],
  });
  assertInviteStillValid(member);

  if (normalizeEmail(member.email) !== email) {
    throw new Error('This invite is for a different email address');
  }

  const existingMembership = await rawDb.single('v2_tenant_users', {
    filters: [eq('auth_user_id', authUserId)],
  });
  if (existingMembership && String(existingMembership.id) !== String(member.id)) {
    throw new Error('This user already belongs to another workspace');
  }

  const updatePatch = {
    auth_user_id: authUserId,
    status: 'active',
    invite_token: null,
    updated_at: new Date().toISOString(),
  };

  let updated = null;
  try {
    [updated] = await rawDb.update('v2_tenant_users', [eq('id', member.id)], {
      ...updatePatch,
      accepted_at: new Date().toISOString(),
    });
  } catch (error) {
    if (!isMissingColumnError(error, 'accepted_at')) {
      throw error;
    }
    [updated] = await rawDb.update('v2_tenant_users', [eq('id', member.id)], updatePatch);
  }

  const scopedDb = createTenantScopedDb(rawDb, member.tenant_id);
  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: email,
    eventType: 'invite_accepted',
    targetType: 'tenant_user',
    targetId: member.id,
    detail: {
      role: member.role,
      invited_email: member.email,
    },
  });

  const tenantContext = await resolveTenantContext(rawDb, {
    ...user,
    id: authUserId,
    email,
  });

  return {
    member: presentMember(updated || member),
    account: tenantContext?.presentedTenant || null,
    onboarding: tenantContext?.onboarding || null,
  };
}

export async function createWorkspaceInvite(env, rawDb, tenantContext, payload, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);

  const email = normalizeEmail(payload?.email);
  const role = ['admin', 'member'].includes(String(payload?.role || '')) ? String(payload.role) : 'member';
  const fullName = compactText(payload?.full_name);

  if (!email || !email.includes('@')) {
    throw new Error('A valid email is required');
  }

  if (tenantContext.member.role !== 'owner' && role === 'admin') {
    throw new Error('Only owners can invite admins');
  }

  const existing = await rawDb.single('v2_tenant_users', {
    filters: [eq('tenant_id', tenantContext.tenant.id), eq('email', email)],
  });
  if (existing?.status === 'active') {
    throw new Error('That user already has workspace access');
  }

  const now = new Date().toISOString();
  const token = inviteToken();
  const expiresAt = inviteExpiresAt();
  const inviteLink = `${resolveAppUrl(env) || ''}/accept-invite?token=${encodeURIComponent(token)}`;
  const [member] = await rawDb.upsert('v2_tenant_users', {
    tenant_id: tenantContext.tenant.id,
    email,
    full_name: fullName || null,
    role,
    status: 'invited',
    can_manage_billing: false,
    invited_by: actorId || tenantContext.member.email,
    invite_token: token,
    invited_at: now,
    invite_expires_at: expiresAt,
    disabled_at: null,
    updated_at: now,
  }, 'tenant_id,email');

  const generatedActionLink = inviteLink
    ? await tryGenerateSupabaseInvite(env, email, inviteLink, {
        workspace_slug: tenantContext.tenant.slug,
        invite_token: token,
        role,
      }).catch(() => null)
    : null;
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'member_invited',
    targetType: 'tenant_user',
    targetId: member.id,
    detail: {
      email,
      role,
      invite_expires_at: expiresAt,
    },
  });

  return {
    member: presentMember(member),
    invite_url: inviteLink || null,
    auth_invite_url: generatedActionLink || null,
  };
}

export async function resendWorkspaceInvite(env, rawDb, tenantContext, memberId, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);

  const existing = await rawDb.single('v2_tenant_users', {
    filters: [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)],
  });
  if (!existing || existing.status !== 'invited') {
    throw new Error('Invite not found');
  }

  const token = inviteToken();
  const expiresAt = inviteExpiresAt();
  const inviteUrl = `${resolveAppUrl(env) || ''}/accept-invite?token=${encodeURIComponent(token)}`;
  const [member] = await rawDb.update('v2_tenant_users', [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)], {
    invite_token: token,
    invited_at: new Date().toISOString(),
    invite_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  const generatedActionLink = inviteUrl
    ? await tryGenerateSupabaseInvite(env, existing.email, inviteUrl, {
        workspace_slug: tenantContext.tenant.slug,
        invite_token: token,
        role: existing.role,
      }).catch(() => null)
    : null;
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'member_invite_resent',
    targetType: 'tenant_user',
    targetId: memberId,
    detail: {
      email: existing.email,
      role: existing.role,
      invite_expires_at: expiresAt,
    },
  });

  return {
    member: presentMember(member || existing),
    invite_url: inviteUrl || null,
    auth_invite_url: generatedActionLink || null,
  };
}

export async function disableWorkspaceMember(rawDb, tenantContext, memberId, actorId = null) {
  assertWorkspaceManager(tenantContext?.member);

  const existing = await rawDb.single('v2_tenant_users', {
    filters: [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)],
  });
  if (!existing) {
    throw new Error('Member not found');
  }
  if (existing.role === 'owner') {
    throw new Error('Transfer ownership before disabling the current owner');
  }

  const [member] = await rawDb.update('v2_tenant_users', [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)], {
    status: 'disabled',
    disabled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'member_disabled',
    targetType: 'tenant_user',
    targetId: memberId,
    detail: {
      email: existing.email,
      role: existing.role,
    },
  });

  return {
    member: presentMember(member || existing),
    members: await listMembers(rawDb, tenantContext.tenant.id),
  };
}

export async function updateWorkspaceMemberRole(rawDb, tenantContext, memberId, nextRole, actorId = null) {
  assertOwner(tenantContext?.member);
  const role = ['owner', 'admin', 'member'].includes(String(nextRole || '')) ? String(nextRole) : '';
  if (!role) {
    throw new Error('A valid role is required');
  }
  if (role === 'owner') {
    throw new Error('Use ownership transfer to promote another owner');
  }

  const existing = await rawDb.single('v2_tenant_users', {
    filters: [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)],
  });
  if (!existing) {
    throw new Error('Member not found');
  }

  const [member] = await rawDb.update('v2_tenant_users', [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)], {
    role,
    can_manage_billing: role === 'owner',
    updated_at: new Date().toISOString(),
  });
  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);

  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'member_role_changed',
    targetType: 'tenant_user',
    targetId: memberId,
    detail: {
      email: existing.email,
      from_role: existing.role,
      to_role: role,
    },
  });

  return {
    member: presentMember(member || existing),
    members: await listMembers(rawDb, tenantContext.tenant.id),
  };
}

export async function transferWorkspaceOwnership(rawDb, tenantContext, memberId, actorId = null) {
  assertOwner(tenantContext?.member);
  if (String(memberId) === String(tenantContext.member.id)) {
    throw new Error('Choose another active member before transferring ownership');
  }

  const nextOwner = await rawDb.single('v2_tenant_users', {
    filters: [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)],
  });
  if (!nextOwner || nextOwner.status !== 'active') {
    throw new Error('Ownership can only be transferred to an active member');
  }

  await rawDb.update('v2_tenant_users', [eq('id', tenantContext.member.id), eq('tenant_id', tenantContext.tenant.id)], {
    role: 'admin',
    can_manage_billing: false,
    updated_at: new Date().toISOString(),
  });
  await rawDb.update('v2_tenant_users', [eq('id', memberId), eq('tenant_id', tenantContext.tenant.id)], {
    role: 'owner',
    can_manage_billing: true,
    updated_at: new Date().toISOString(),
  });

  const scopedDb = createTenantScopedDb(rawDb, tenantContext.tenant.id);
  await appendAuditEvent(scopedDb, {
    actorType: 'user',
    actorId: actorId || tenantContext.member.email,
    eventType: 'ownership_transferred',
    targetType: 'tenant_user',
    targetId: memberId,
    detail: {
      previous_owner: tenantContext.member.email,
      next_owner: nextOwner.email,
    },
  });

  return {
    members: await listMembers(rawDb, tenantContext.tenant.id),
  };
}
