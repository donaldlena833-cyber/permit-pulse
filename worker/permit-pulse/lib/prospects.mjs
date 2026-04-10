import { sendAutomationEmail } from '../gmail.mjs';
import { getAppConfig } from './config.mjs';
import { formatPriorOutreachMessage, getPriorOutreach } from './outreach-guard.mjs';
import { eq, inList, order } from './supabase.mjs';
import { resolveWorkspaceSender } from './workspace-email.mjs';
import {
  addDaysToDateKey,
  formatLocalDateKey,
  zonedDateTimeToUtcIso,
} from './timezone.mjs';
import { nowIso } from './utils.mjs';

export const PROSPECT_CATEGORIES = [
  'architect',
  'interior_designer',
  'property_manager',
  'project_manager',
  'gc',
];

export const PROSPECT_STATUSES = ['new', 'drafted', 'sent', 'replied', 'opted_out', 'archived'];

const CATEGORY_LABELS = {
  interior_designer: 'Interior Designer',
  gc: 'GC',
  property_manager: 'Property Manager',
  project_manager: 'Project Manager',
  architect: 'Architect',
};

const GENERIC_LOCAL_PARTS = new Set([
  'admin',
  'contact',
  'desk',
  'hello',
  'hi',
  'info',
  'inquiries',
  'inquiry',
  'mail',
  'office',
  'operations',
  'sales',
  'service',
  'studio',
  'team',
]);

const FREE_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);

const FIELD_ALIASES = {
  company_name: ['company', 'company_name', 'company name', 'firm', 'organization', 'organisation', 'studio', 'business'],
  contact_name: [
    'contact',
    'contact_name',
    'contact name',
    'name',
    'full_name',
    'full name',
    'person',
    'contacts',
    'contacts_name_role',
    'contacts_name_and_role',
  ],
  contact_role: ['role', 'title', 'position', 'job_title', 'job title'],
  email_address: [
    'email',
    'email_address',
    'email address',
    'e-mail',
    'work_email',
    'work email',
    'email_cc_list',
    'email_and_cc_list',
    'email_cc',
    'cc_list',
    'emails',
  ],
  phone: ['phone', 'phone_number', 'phone number', 'mobile', 'cell', 'telephone'],
  website: ['website', 'site', 'url', 'domain', 'company website'],
  category: ['category', 'lane', 'segment'],
  city: ['city', 'town'],
  state: ['state', 'province'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'desc', 'outreach_insight', 'insight'],
};

const EMAIL_ALIAS_KEYS = new Set(FIELD_ALIASES.email_address.map((alias) => slugHeader(alias)));

function categoryCounter(initialValue = 0) {
  return Object.fromEntries(PROSPECT_CATEGORIES.map((category) => [category, initialValue]));
}

function chunk(items, size) {
  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function compactText(value) {
  const next = String(value || '').replace(/\s+/g, ' ').trim();
  return next || null;
}

function compactMultilineText(value) {
  const next = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return next || null;
}

function normalizeEmail(value) {
  const email = compactText(value)?.toLowerCase() || null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function extractPrimaryEmail(value) {
  const text = compactText(value);
  if (!text) {
    return null;
  }

  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
  if (!matches?.length) {
    return null;
  }

  return normalizeEmail(matches[0]);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return digits || null;
}

function normalizeWebsite(value) {
  const cleaned = compactText(value);
  if (!cleaned) {
    return null;
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  if (/^[\w.-]+\.[a-z]{2,}/i.test(cleaned)) {
    return `https://${cleaned}`;
  }
  return cleaned;
}

function slugHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRow(row) {
  const entries = Object.entries(row || {});
  return Object.fromEntries(entries.map(([key, value]) => [slugHeader(key), value]));
}

function pickField(row, aliases) {
  for (const alias of aliases) {
    const match = row[slugHeader(alias)];
    const value = compactText(match);
    if (value) {
      return value;
    }
  }
  return null;
}

function looksLikeEmailField(key) {
  const slug = slugHeader(key);
  if (!slug) {
    return false;
  }

  if (EMAIL_ALIAS_KEYS.has(slug)) {
    return true;
  }

  return slug.includes('email') || slug.includes('e_mail');
}

function pickEmailField(row) {
  for (const alias of FIELD_ALIASES.email_address) {
    const value = compactText(row?.[slugHeader(alias)]);
    const email = extractPrimaryEmail(value);
    if (email) {
      return email;
    }
  }

  for (const [key, rawValue] of Object.entries(row || {})) {
    if (!looksLikeEmailField(key) || EMAIL_ALIAS_KEYS.has(slugHeader(key))) {
      continue;
    }

    const email = extractPrimaryEmail(rawValue);
    if (email) {
      return email;
    }
  }

  return null;
}

function parseCombinedContact(value) {
  const text = compactText(value);
  if (!text) {
    return { name: null, role: null };
  }

  const match = text.match(/^(.*?)(?:\s*\(([^()]+)\))$/);
  if (!match) {
    return { name: text, role: null };
  }

  return {
    name: compactText(match[1]),
    role: compactText(match[2]),
  };
}

function normalizeProspectCategory(value, fallback = null) {
  const text = compactText(value)?.toLowerCase() || null;
  if (!text) {
    return fallback;
  }

  if (PROSPECT_CATEGORIES.includes(text)) {
    return text;
  }
  if (text.includes('architect') || text.includes('urban design')) {
    return 'architect';
  }
  if (text.includes('interior')) {
    return 'interior_designer';
  }
  if (text.includes('property manager') || text.includes('property management')) {
    return 'property_manager';
  }
  if (text.includes('project manager') || text.includes('project management')) {
    return 'project_manager';
  }
  if (
    text.includes('gc')
    || text.includes('general contractor')
    || text.includes('general construction')
    || text.includes('contractor')
  ) {
    return 'gc';
  }

  return fallback;
}

function greetingName(prospect) {
  const contact = compactText(prospect.contact_name);
  if (!contact) {
    return null;
  }

  return contact.split(/\s+/)[0] || null;
}

function emailDomain(value) {
  const normalized = normalizeEmail(value);
  if (!normalized || !normalized.includes('@')) {
    return null;
  }
  return normalized.split('@').pop() || null;
}

function emailLocalPart(value) {
  const normalized = normalizeEmail(value);
  if (!normalized || !normalized.includes('@')) {
    return null;
  }
  return normalized.split('@')[0] || null;
}

function normalizeDomain(value) {
  const text = compactText(value)?.toLowerCase() || null;
  if (!text) {
    return null;
  }
  return text.replace(/^www\./, '').trim();
}

function websiteDomain(value) {
  const website = normalizeWebsite(value);
  if (!website) {
    return null;
  }
  try {
    return normalizeDomain(new URL(website).hostname);
  } catch {
    return normalizeDomain(website.replace(/^https?:\/\//i, '').split('/')[0] || null);
  }
}

function companyDomainForProspect(prospect) {
  const website = websiteDomain(prospect?.website);
  if (website) {
    return website;
  }

  const domain = normalizeDomain(emailDomain(prospect?.email_address));
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) {
    return null;
  }
  return domain;
}

function normalizeCompanyNameKey(value) {
  const text = compactText(value)?.toLowerCase() || null;
  if (!text) {
    return null;
  }
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

function companyNameForProspect(prospect) {
  return compactText(prospect?.company_name)
    || compactText(prospect?.contact_name)
    || compactText(prospect?.email_address)
    || 'Unknown company';
}

function normalizeSuppressionScopeValue(value) {
  return compactText(value)?.toLowerCase() || null;
}

function isMissingProspectCrmError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('42P01')
    || message.includes('42703')
    || message.includes('schema cache')
    || message.includes('v2_prospect_companies')
    || message.includes('v2_prospect_campaigns')
    || message.includes('v2_prospect_suppressions')
    || message.includes('v2_outreach_review_queue')
    || message.includes('company_id')
    || message.includes('campaign_id')
    || message.includes('personalization_summary')
    || message.includes('skipped_by_reason');
}

function greetingLine(prospect) {
  const localPart = emailLocalPart(prospect?.email_address);
  const firstName = greetingName(prospect);

  if (!firstName || (localPart && GENERIC_LOCAL_PARTS.has(localPart))) {
    return 'Hello,';
  }

  return `Hi ${firstName},`;
}

function workspaceBusinessName(workspace) {
  return compactText(workspace?.business_name) || compactText(workspace?.name) || 'our team';
}

function workspaceSenderName(workspace) {
  return compactText(workspace?.sender_name) || workspaceBusinessName(workspace);
}

function workspaceWebsiteLabel(workspace) {
  const website = compactText(workspace?.website);
  if (!website) {
    return null;
  }

  return website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function workspacePitch(workspace, category) {
  return compactText(workspace?.outreach_pitch) || categoryPitch(category);
}

function workspaceFocus(workspace, prospect) {
  return compactText(workspace?.outreach_focus) || categoryFocusLine(prospect);
}

function workspaceCta(workspace) {
  return compactText(workspace?.outreach_cta)
    || 'If anything is coming up, I would be glad to take a look and turn around pricing quickly.';
}

function workspaceSignatureLines(workspace) {
  return [
    'Best,',
    workspaceSenderName(workspace),
    workspaceBusinessName(workspace),
    compactText(workspace?.phone) || null,
    workspaceWebsiteLabel(workspace),
  ].filter(Boolean);
}

function categoryPitch(category) {
  if (category === 'architect') {
    return 'help architects keep glass details clean and coordination responsive';
  }
  if (category === 'interior_designer') {
    return 'help interior designers turn glass ideas into clean installs';
  }
  if (category === 'property_manager') {
    return 'help property managers move replacement and upgrade glass work quickly';
  }
  if (category === 'project_manager') {
    return 'help project managers keep glass scope moving without a long handoff';
  }
  return 'help contractors handle pricing, fabrication, and install coordination for custom glass scope';
}

function topicLine(prospect) {
  if (prospect.category === 'architect') {
    return 'architects';
  }
  if (prospect.category === 'interior_designer') {
    return 'interior designers';
  }
  if (prospect.category === 'property_manager') {
    return 'property managers';
  }
  if (prospect.category === 'project_manager') {
    return 'project managers';
  }
  return 'contractors';
}

function categoryFocusLine(prospect) {
  return `We help ${topicLine(prospect)} with pricing, fabrication, and install coordination.`;
}

function trimTrailingPunctuation(value) {
  return String(value || '').replace(/[.,;:!?-]+$/g, '').trim();
}

function firstDescriptionSnippet(prospect, maxLength = 180) {
  const notes = compactText(prospect?.notes);
  if (!notes) {
    return null;
  }

  const firstSentence = notes
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .find(Boolean) || notes;
  const trimmed = trimTrailingPunctuation(firstSentence);
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function shouldUseStoredInitialDraft(prospect) {
  return prospect?.status === 'drafted' || Boolean(prospect?.first_sent_at);
}

function isProspectSuppressed(prospect) {
  return Boolean(prospect?.do_not_contact || prospect?.status === 'opted_out' || prospect?.opted_out_at);
}

function buildSuppressionMaps(rows = []) {
  const byEmail = new Map();
  const byDomain = new Map();
  const byCompanyId = new Map();
  const byCompanyName = new Map();

  for (const row of rows) {
    if (!row || row.active === false) {
      continue;
    }
    const scopeValue = normalizeSuppressionScopeValue(row.scope_value);
    if (!scopeValue) {
      continue;
    }
    if (row.scope_type === 'email' && !byEmail.has(scopeValue)) {
      byEmail.set(scopeValue, row);
    }
    if (row.scope_type === 'domain' && !byDomain.has(scopeValue)) {
      byDomain.set(scopeValue, row);
    }
    if (row.scope_type === 'company' && row.company_id && !byCompanyId.has(String(row.company_id))) {
      byCompanyId.set(String(row.company_id), row);
    }
    if (row.scope_type === 'company') {
      const normalizedName = normalizeCompanyNameKey(scopeValue);
      if (normalizedName && !byCompanyName.has(normalizedName)) {
        byCompanyName.set(normalizedName, row);
      }
    }
  }

  return {
    byEmail,
    byDomain,
    byCompanyId,
    byCompanyName,
  };
}

function explicitSuppressionReason(prospect, suppressionMaps) {
  if (!suppressionMaps) {
    return null;
  }

  const email = normalizeEmail(prospect?.email_address);
  if (email && suppressionMaps.byEmail?.has(email)) {
    return suppressionMaps.byEmail.get(email)?.reason || 'suppressed_email';
  }

  const domain = normalizeSuppressionScopeValue(companyDomainForProspect(prospect));
  if (domain && suppressionMaps.byDomain?.has(domain)) {
    return suppressionMaps.byDomain.get(domain)?.reason || 'suppressed_domain';
  }

  if (prospect?.company_id && suppressionMaps.byCompanyId?.has(String(prospect.company_id))) {
    return suppressionMaps.byCompanyId.get(String(prospect.company_id))?.reason || 'suppressed_company';
  }

  const companyName = normalizeCompanyNameKey(prospect?.company_name);
  if (companyName && suppressionMaps.byCompanyName?.has(companyName)) {
    return suppressionMaps.byCompanyName.get(companyName)?.reason || 'suppressed_company';
  }

  return null;
}

function buildReviewMaps(rows = []) {
  const byEmail = new Map();
  const byThreadId = new Map();

  for (const row of rows) {
    if (!row || row.status !== 'pending') {
      continue;
    }

    const email = normalizeEmail(row.target_email || row.sender_email);
    if (email && !byEmail.has(email)) {
      byEmail.set(email, row);
    }

    if (row.gmail_thread_id && !byThreadId.has(String(row.gmail_thread_id))) {
      byThreadId.set(String(row.gmail_thread_id), row);
    }
  }

  return {
    byEmail,
    byThreadId,
  };
}

function buildCompanyMap(rows = []) {
  return Object.fromEntries((rows || []).filter(Boolean).map((row) => [String(row.id), row]));
}

function buildCampaignMap(rows = []) {
  return Object.fromEntries((rows || []).filter(Boolean).map((row) => [String(row.id), row]));
}

function companyPreview(prospect, company) {
  if (!company && !prospect) {
    return null;
  }

  return {
    id: company?.id || prospect?.company_id || null,
    name: company?.name || companyNameForProspect(prospect),
    domain: company?.domain || companyDomainForProspect(prospect),
    website: company?.website || normalizeWebsite(prospect?.website),
    category: company?.category || prospect?.category || null,
    suppressed: Boolean(company?.suppressed),
    suppressed_reason: company?.suppressed_reason || null,
  };
}

function campaignPreview(prospect, campaign) {
  if (!campaign && !prospect?.category) {
    return null;
  }

  return {
    id: campaign?.id || prospect?.campaign_id || null,
    name: campaign?.name || `${CATEGORY_LABELS[prospect?.category] || 'Prospect'} Outreach`,
    category: campaign?.category || prospect?.category || null,
    status: campaign?.status || 'active',
    template_variant: campaign?.template_variant || 'default',
    daily_cap: Number(campaign?.daily_cap || 10),
    timezone: campaign?.timezone || 'America/New_York',
    send_time_local: campaign?.send_time_local || '11:00',
  };
}

function pendingReviewReason(prospect, reviewMaps) {
  if (!reviewMaps) {
    return null;
  }

  const email = normalizeEmail(prospect?.email_address);
  if (email && reviewMaps.byEmail?.has(email)) {
    return reviewMaps.byEmail.get(email)?.reason || 'reply_review_pending';
  }

  if (prospect?.gmail_thread_id && reviewMaps.byThreadId?.has(String(prospect.gmail_thread_id))) {
    return reviewMaps.byThreadId.get(String(prospect.gmail_thread_id))?.reason || 'reply_review_pending';
  }

  return null;
}

function buildSuppressedDomainMap(prospects, outcomes = []) {
  const suppressed = new Map();

  for (const prospect of prospects || []) {
    const domain = companyDomainForProspect(prospect);
    if (!domain) {
      continue;
    }

    if (prospect.do_not_contact || prospect.status === 'opted_out' || prospect.opted_out_at) {
      suppressed.set(domain, 'company_opted_out');
      continue;
    }

    if (prospect.status === 'replied' || prospect.last_replied_at) {
      if (!suppressed.has(domain)) {
        suppressed.set(domain, 'company_replied');
      }
    }
  }

  for (const outcome of outcomes || []) {
    if (String(outcome?.outcome || '').toLowerCase() !== 'bounced') {
      continue;
    }

    const domain = normalizeDomain(emailDomain(outcome.email_address));
    if (!domain || FREE_EMAIL_DOMAINS.has(domain) || suppressed.has(domain)) {
      continue;
    }
    suppressed.set(domain, 'company_bounced');
  }

  return suppressed;
}

function companySuppressionReason(prospect, suppressedDomains) {
  if (!suppressedDomains || !(suppressedDomains instanceof Map)) {
    return null;
  }
  const domain = companyDomainForProspect(prospect);
  if (!domain) {
    return null;
  }
  return suppressedDomains.get(domain) || null;
}

function deriveQueueState(prospect, followUps = []) {
  if (!prospect) {
    return 'queued_initial';
  }

  if (prospect.status === 'opted_out' || prospect.do_not_contact || prospect.opted_out_at) {
    return 'opted_out';
  }
  if (prospect.status === 'archived') {
    return 'archived';
  }
  if (prospect.status === 'replied') {
    return 'replied';
  }

  const pendingFollowUp = followUps.find((followUp) => followUp.status === 'pending');
  const sentFollowUp = followUps.find((followUp) => followUp.status === 'sent');

  if (!prospect.first_sent_at) {
    return 'queued_initial';
  }
  if (pendingFollowUp) {
    return 'queued_follow_up';
  }
  if (sentFollowUp || prospect.last_follow_up_at) {
    return 'follow_up_sent';
  }
  return 'sent';
}

function mergeValue(nextValue, currentValue) {
  if (nextValue === undefined || nextValue === null || nextValue === '') {
    return currentValue ?? null;
  }
  return nextValue;
}

function normalizeProspectRow(row, category) {
  const normalized = normalizeRow(row);
  const emailAddress = pickEmailField(normalized);
  const rowCategory = pickField(normalized, FIELD_ALIASES.category);
  const nextCategory = normalizeProspectCategory(rowCategory, category);
  const combinedContact = parseCombinedContact(pickField(normalized, FIELD_ALIASES.contact_name));
  const explicitRole = compactText(pickField(normalized, FIELD_ALIASES.contact_role));

  if (!emailAddress) {
    return null;
  }

  return {
    category: nextCategory,
    company_name: compactText(pickField(normalized, FIELD_ALIASES.company_name)),
    contact_name: combinedContact.name,
    contact_role: explicitRole || combinedContact.role,
    email_address: emailAddress,
    email_normalized: emailAddress,
    phone: normalizePhone(pickField(normalized, FIELD_ALIASES.phone)),
    website: normalizeWebsite(pickField(normalized, FIELD_ALIASES.website)),
    city: compactText(pickField(normalized, FIELD_ALIASES.city)),
    state: compactText(pickField(normalized, FIELD_ALIASES.state)),
    notes: compactText(pickField(normalized, FIELD_ALIASES.notes)),
  };
}

function normalizeProspectRowResult(row, category) {
  const normalized = normalizeProspectRow(row, category);
  if (normalized) {
    return { row: normalized, reason: null };
  }
  return {
    row: null,
    reason: 'missing_valid_email',
  };
}

function findProspectFollowUps(followUps, prospectId) {
  return (followUps || []).filter((row) => String(row.prospect_id) === String(prospectId));
}

function hydrateProspect(prospect, options = {}) {
  if (!prospect) {
    return null;
  }

  const followUps = Array.isArray(options.followUps) ? options.followUps : [];
  const draft = buildProspectDraft(prospect, options.workspace || null);
  const companySuppressed = companySuppressionReason(prospect, options.suppressedDomains);
  const explicitSuppression = explicitSuppressionReason(prospect, options.suppressionMaps);
  const reviewPending = pendingReviewReason(prospect, options.reviewMaps);
  const queueState = reviewPending && !explicitSuppression && !companySuppressed && !isProspectSuppressed(prospect) && !['replied', 'archived'].includes(String(prospect.status || ''))
    ? 'pending_review'
    : (explicitSuppression || companySuppressed) && !isProspectSuppressed(prospect) && !['replied', 'archived'].includes(String(prospect.status || ''))
    ? 'suppressed'
    : deriveQueueState(prospect, followUps);
  return {
    ...prospect,
    draft_subject: draft.subject,
    draft_body: draft.body,
    queue_state: queueState,
    next_follow_up: followUps.find((followUp) => followUp.status === 'pending') || null,
    automation_block_reason: isProspectSuppressed(prospect) ? 'opted_out' : explicitSuppression || companySuppressed || reviewPending,
    company_domain: companyDomainForProspect(prospect),
    company: companyPreview(prospect, prospect.company || options.companyMap?.[String(prospect.company_id)] || null),
    campaign: campaignPreview(prospect, prospect.campaign || options.campaignMap?.[String(prospect.campaign_id)] || null),
  };
}

async function insertMany(db, table, rows) {
  for (const group of chunk(rows, 100)) {
    if (!group.length) {
      continue;
    }
    await db.insert(table, group);
  }
}

async function listAllProspects(db) {
  return db.select('v2_prospects', {
    ordering: [order('created_at', 'asc')],
  });
}

async function listProspectCompanies(db) {
  try {
    return await db.select('v2_prospect_companies', {
      ordering: [order('updated_at', 'desc')],
      limit: 500,
    });
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return [];
  }
}

async function listProspectCampaigns(db) {
  try {
    return await db.select('v2_prospect_campaigns', {
      ordering: [order('created_at', 'asc')],
      limit: 100,
    });
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return [];
  }
}

async function listProspectSuppressions(db) {
  try {
    return await db.select('v2_prospect_suppressions', {
      ordering: [order('created_at', 'desc')],
      limit: 500,
    });
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return [];
  }
}

async function listOutreachReviewQueue(db) {
  try {
    return await db.select('v2_outreach_review_queue', {
      ordering: [order('created_at', 'desc')],
      limit: 100,
    });
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return [];
  }
}

async function ensureCampaignForCategory(db, category) {
  try {
    const existing = await db.select('v2_prospect_campaigns', {
      filters: [eq('category', category), eq('status', 'active')],
      ordering: [order('created_at', 'asc')],
      limit: 1,
    });
    if (existing[0]) {
      return existing[0];
    }

    const [created] = await db.insert('v2_prospect_campaigns', {
      name: `${CATEGORY_LABELS[category] || category} Outreach`,
      category,
      status: 'active',
      template_variant: 'default',
      daily_cap: 10,
      send_time_local: '11:00',
      timezone: 'America/New_York',
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return created || null;
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return null;
  }
}

async function ensureCompanyRecord(db, prospect) {
  const normalizedName = normalizeCompanyNameKey(companyNameForProspect(prospect));
  const domain = companyDomainForProspect(prospect);
  const website = normalizeWebsite(prospect.website);

  if (!normalizedName && !domain) {
    return null;
  }

  try {
    const existing = domain
      ? await db.select('v2_prospect_companies', {
        filters: [eq('domain', domain)],
        limit: 1,
      })
      : await db.select('v2_prospect_companies', {
        filters: [eq('normalized_name', normalizedName)],
        limit: 1,
      });

    if (existing[0]) {
      const [updated] = await db.update('v2_prospect_companies', [eq('id', existing[0].id)], {
        name: existing[0].name || companyNameForProspect(prospect),
        normalized_name: normalizedName || existing[0].normalized_name,
        domain: domain || existing[0].domain || null,
        website: website || existing[0].website || null,
        category: prospect.category || existing[0].category || null,
        updated_at: nowIso(),
      });
      return updated || existing[0];
    }

    const [created] = await db.insert('v2_prospect_companies', {
      normalized_name: normalizedName || domain || crypto.randomUUID(),
      name: companyNameForProspect(prospect),
      domain: domain || null,
      website: website || null,
      category: prospect.category || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return created || null;
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return null;
  }
}

async function syncProspectCrmLinkage(db, prospect, options = {}) {
  const company = await ensureCompanyRecord(db, prospect);
  const campaign = options.campaignId
    ? { id: options.campaignId }
    : await ensureCampaignForCategory(db, prospect.category);

  const patch = {
    company_id: company?.id || prospect.company_id || null,
    campaign_id: campaign?.id || prospect.campaign_id || null,
    personalization_summary: firstDescriptionSnippet(prospect, 220),
    updated_at: nowIso(),
  };

  const shouldPatch = Boolean(
    patch.company_id !== prospect.company_id
    || patch.campaign_id !== prospect.campaign_id
    || patch.personalization_summary !== (prospect.personalization_summary || null),
  );

  if (!shouldPatch) {
    return {
      ...prospect,
      company_id: patch.company_id,
      campaign_id: patch.campaign_id,
      personalization_summary: patch.personalization_summary,
      company,
      campaign,
    };
  }

  try {
    const [updated] = await db.update('v2_prospects', [eq('id', prospect.id)], patch);
    return {
      ...(updated || prospect),
      company_id: patch.company_id,
      campaign_id: patch.campaign_id,
      personalization_summary: patch.personalization_summary,
      company,
      campaign,
    };
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return {
      ...prospect,
      company_id: patch.company_id,
      campaign_id: patch.campaign_id,
      personalization_summary: patch.personalization_summary,
      company,
      campaign,
    };
  }
}

function derivedSuppressionRows(prospect, reason, source = 'system', actorId = null) {
  const rows = [];
  const email = normalizeEmail(prospect?.email_address);
  const domain = normalizeSuppressionScopeValue(companyDomainForProspect(prospect));
  const companyName = normalizeCompanyNameKey(prospect?.company_name);

  if (email) {
    rows.push({
      scope_type: 'email',
      scope_value: email,
      company_id: prospect?.company_id || null,
      prospect_id: prospect?.id || null,
      reason,
      source,
      active: true,
      created_by: actorId,
      updated_at: nowIso(),
    });
  }
  if (domain) {
    rows.push({
      scope_type: 'domain',
      scope_value: domain,
      company_id: prospect?.company_id || null,
      prospect_id: prospect?.id || null,
      reason,
      source,
      active: true,
      created_by: actorId,
      updated_at: nowIso(),
    });
  }
  if (companyName) {
    rows.push({
      scope_type: 'company',
      scope_value: companyName,
      company_id: prospect?.company_id || null,
      prospect_id: prospect?.id || null,
      reason,
      source,
      active: true,
      created_by: actorId,
      updated_at: nowIso(),
    });
  }

  return rows;
}

async function upsertSuppressionRow(db, row) {
  try {
    const existing = await db.select('v2_prospect_suppressions', {
      filters: [eq('scope_type', row.scope_type), eq('scope_value', row.scope_value)],
      limit: 1,
    });

    if (existing[0]) {
      const [updated] = await db.update('v2_prospect_suppressions', [eq('id', existing[0].id)], {
        ...row,
        active: true,
      });
      return updated || existing[0];
    }

    const [created] = await db.insert('v2_prospect_suppressions', {
      created_at: nowIso(),
      ...row,
    });
    return created || null;
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return null;
  }
}

async function syncDerivedSuppressions(db, prospect, reason, source = 'system', actorId = null) {
  const rows = derivedSuppressionRows(prospect, reason, source, actorId);
  const created = [];

  for (const row of rows) {
    const saved = await upsertSuppressionRow(db, row);
    if (saved) {
      created.push(saved);
    }
  }

  if (prospect?.company_id) {
    await db.update('v2_prospect_companies', [eq('id', prospect.company_id)], {
      suppressed: true,
      suppressed_reason: reason,
      updated_at: nowIso(),
    }).catch(() => []);
  }

  return created;
}

export async function createProspectSuppression(db, payload, actorId = null) {
  const scopeType = ['email', 'domain', 'company'].includes(String(payload?.scope_type || '')) ? String(payload.scope_type) : null;
  const scopeValue = normalizeSuppressionScopeValue(payload?.scope_value);
  const reason = compactText(payload?.reason) || 'manual_suppression';

  if (!scopeType || !scopeValue) {
    throw new Error('Suppression requires a valid scope and value');
  }

  const saved = await upsertSuppressionRow(db, {
    scope_type: scopeType,
    scope_value: scopeValue,
    company_id: payload?.company_id || null,
    prospect_id: payload?.prospect_id || null,
    reason,
    source: 'operator',
    active: true,
    created_by: actorId,
    updated_at: nowIso(),
  });

  if (saved?.company_id) {
    await db.update('v2_prospect_companies', [eq('id', saved.company_id)], {
      suppressed: true,
      suppressed_reason: reason,
      updated_at: nowIso(),
    }).catch(() => []);
  }

  return saved;
}

export async function suppressProspectScope(db, prospectId, scopeType, actorId = null, reason = 'manual_suppression') {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const linked = await syncProspectCrmLinkage(db, prospect);
  let scopeValue = null;

  if (scopeType === 'email') {
    scopeValue = normalizeEmail(linked.email_address);
  } else if (scopeType === 'domain') {
    scopeValue = normalizeSuppressionScopeValue(companyDomainForProspect(linked));
  } else if (scopeType === 'company') {
    scopeValue = normalizeCompanyNameKey(companyNameForProspect(linked));
  }

  if (!scopeValue) {
    throw new Error('Could not derive a valid suppression scope for this contact');
  }

  const saved = await createProspectSuppression(db, {
    scope_type: scopeType,
    scope_value: scopeValue,
    company_id: linked.company_id || null,
    prospect_id: linked.id,
    reason,
  }, actorId);

  await recordProspectEvent(db, prospectId, 'manual_suppressed', 'operator', actorId, {
    scope_type: scopeType,
    scope_value: scopeValue,
    reason,
  });

  return saved;
}

export async function removeProspectSuppression(db, suppressionId, actorId = null) {
  const [updated] = await db.update('v2_prospect_suppressions', [eq('id', suppressionId)], {
    active: false,
    updated_at: nowIso(),
    created_by: actorId,
  }).catch(() => []);

  if (updated?.company_id) {
    const companySuppressions = await db.select('v2_prospect_suppressions', {
      filters: [eq('company_id', updated.company_id), eq('active', true)],
      limit: 10,
    }).catch((error) => {
      if (!isMissingProspectCrmError(error)) {
        throw error;
      }
      return [];
    });
    if (!companySuppressions.length) {
      await db.update('v2_prospect_companies', [eq('id', updated.company_id)], {
        suppressed: false,
        suppressed_reason: null,
        updated_at: nowIso(),
      }).catch(() => []);
    }
  }
  return updated || null;
}

async function enqueueReviewItem(db, payload) {
  try {
    const existing = await db.select('v2_outreach_review_queue', {
      filters: [eq('gmail_message_id', payload.gmail_message_id)],
      limit: 1,
    });
    if (existing[0]) {
      return existing[0];
    }
    const row = {
      review_kind: payload.review_kind || 'reply',
      gmail_message_id: payload.gmail_message_id,
      gmail_thread_id: payload.gmail_thread_id || null,
      sender_email: payload.sender_email || null,
      target_email: payload.target_email || null,
      classification: payload.classification || null,
      reason: payload.reason || null,
      subject: payload.subject || null,
      snippet: payload.snippet || null,
      payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : null,
      status: 'pending',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const [created] = await db.insert('v2_outreach_review_queue', {
      ...row,
    });
    return created || null;
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return null;
  }
}

export async function queueOutreachReviewItem(db, payload) {
  return enqueueReviewItem(db, payload);
}

async function resolvePendingReviewItemsForProspect(db, prospect, action, actorId = null) {
  if (!prospect) {
    return [];
  }

  try {
    const email = normalizeEmail(prospect.email_address);
    const threadId = compactText(prospect.gmail_thread_id);
    const rows = await db.select('v2_outreach_review_queue', {
      ordering: [order('created_at', 'desc')],
      limit: 100,
    });

    const matches = rows.filter((row) => (
      row.status === 'pending'
      && (
        (email && normalizeEmail(row.target_email || row.sender_email) === email)
        || (threadId && compactText(row.gmail_thread_id) === threadId)
      )
    ));

    if (!matches.length) {
      return [];
    }

    const resolved = [];
    const resolvedAt = nowIso();
    for (const row of matches) {
      const [updated] = await db.update('v2_outreach_review_queue', [eq('id', row.id)], {
        status: 'resolved',
        resolved_action: action,
        resolved_by: actorId,
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
      }).catch(() => []);
      resolved.push(updated || row);
    }
    return resolved;
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    return [];
  }
}

export async function resolveOutreachReviewItem(db, reviewId, payload = {}, actorId = null) {
  const review = await db.single('v2_outreach_review_queue', { filters: [eq('id', reviewId)] }).catch(() => null);
  if (!review) {
    throw new Error('Review item not found');
  }

  const action = compactText(payload?.action) || 'ignore';
  if (action === 'ignore') {
    const [updated] = await db.update('v2_outreach_review_queue', [eq('id', reviewId)], {
      status: 'ignored',
      resolved_action: 'ignore',
      resolved_by: actorId,
      resolved_at: nowIso(),
      updated_at: nowIso(),
    });
    return updated || review;
  }

  const prospectId = compactText(payload?.prospect_id);
  if (!prospectId) {
    throw new Error('Resolving this review item requires a prospect');
  }

  if (action === 'mark_opt_out') {
    await optOutProspect(db, prospectId, actorId, 'operator', { source: 'review_queue', review_id: reviewId });
  } else if (action === 'mark_bounced') {
    await markProspectBounced(db, prospectId, actorId, 'operator', { source: 'review_queue', review_id: reviewId });
  } else if (action === 'mark_positive_reply') {
    await markProspectReply(db, prospectId, actorId, 'positive', 'operator', { source: 'review_queue', review_id: reviewId });
  } else {
    await markProspectReply(db, prospectId, actorId, 'neutral', 'operator', { source: 'review_queue', review_id: reviewId });
  }

  const [updated] = await db.update('v2_outreach_review_queue', [eq('id', reviewId)], {
    status: 'resolved',
    resolved_action: action,
    resolved_by: actorId,
    resolved_at: nowIso(),
    updated_at: nowIso(),
  });
  return updated || review;
}

async function listAllProspectFollowUps(db) {
  try {
    return await db.select('v2_prospect_follow_ups', {
      ordering: [order('scheduled_at', 'asc')],
    });
  } catch (error) {
    return [];
  }
}

async function listRecentProspectOutcomes(db) {
  try {
    return await db.select('v2_prospect_outcomes', {
      ordering: [order('created_at', 'desc')],
      limit: 400,
    });
  } catch (error) {
    return [];
  }
}

async function listRecentProspectEvents(db) {
  try {
    return await db.select('v2_prospect_events', {
      ordering: [order('created_at', 'desc')],
      limit: 100,
    });
  } catch (error) {
    return [];
  }
}

function matchesLocalDate(value, dateKey, timeZone) {
  if (!value) {
    return false;
  }
  return formatLocalDateKey(new Date(value), timeZone) === dateKey;
}

function detailKind(row) {
  const kind = row?.detail?.kind;
  return kind === 'follow_up' ? 'follow_up' : kind === 'initial' ? 'initial' : null;
}

function summaryLabel(prospect) {
  return prospect.contact_name || prospect.company_name || prospect.email_address;
}

function baseFollowUpDraft(prospect, workspace = null) {
  const followUpStep = Number(prospect?.follow_up_step || 1);
  const secondTouch = followUpStep >= 2;
  const company = compactText(prospect.company_name) || 'your team';
  const businessName = workspaceBusinessName(workspace);
  const pitch = workspacePitch(workspace, prospect.category);

  return {
    subject: secondTouch
      ? `Final follow-up for ${company}`
      : `Following up on ${company}`,
    body: [
      greetingLine(prospect),
      '',
      secondTouch
        ? `One last note from ${businessName}. We ${pitch}.`
        : `Just following up on my note from ${businessName}. We ${pitch}.`,
      '',
      workspaceFocus(workspace, prospect),
      '',
      secondTouch
        ? 'If the project is still moving, I would be glad to help.'
        : 'If the project is still open, I would be glad to take a look.',
      '',
      ...workspaceSignatureLines(workspace),
    ].filter(Boolean).join('\n'),
  };
}

function initialSubject(prospect, workspace = null) {
  const subjectBase = compactText(prospect.company_name) || compactText(prospect.contact_name) || 'your team';
  const businessName = workspaceBusinessName(workspace);
  return subjectBase ? `Glass scope for ${subjectBase}` : `Quick note from ${businessName}`;
}

function initialBody(prospect, workspace = null) {
  const company = compactText(prospect.company_name);
  const senderName = workspaceSenderName(workspace);
  const businessName = workspaceBusinessName(workspace);
  const pitch = workspacePitch(workspace, prospect.category);

  return [
    greetingLine(prospect),
    '',
    company
      ? `I'm ${senderName} from ${businessName}. I thought ${company} might be a fit for the kind of glass work we handle.`
      : `I'm ${senderName} from ${businessName}. I thought your team might be a fit for the kind of glass work we handle.`,
    `We ${pitch}.`,
    '',
    workspaceCta(workspace),
    '',
    ...workspaceSignatureLines(workspace),
  ].filter(Boolean).join('\n');
}

function isLegacyProspectDraft(subject, body) {
  const text = `${compactText(subject)}\n${compactMultilineText(body)}`.toLowerCase();

  return text.includes('metroglass pro')
    || text.includes('quick intro for')
    || text.includes('about us one-pager')
    || text.includes('quick feel for the work')
    || text.includes('kind of work we support')
    || text.includes('usual back and forth')
    || text.includes('looks closely aligned with the kind of work we support')
    || text.includes('i attached our about us one-pager');
}

function resolveInitialDraft(prospect, workspace = null) {
  const generated = {
    subject: initialSubject(prospect, workspace),
    body: initialBody(prospect, workspace),
  };

  if (!shouldUseStoredInitialDraft(prospect)) {
    return generated;
  }

  const storedSubject = compactText(prospect.draft_subject);
  const storedBody = compactMultilineText(prospect.draft_body);
  if (!storedSubject || !storedBody || isLegacyProspectDraft(storedSubject, storedBody)) {
    return generated;
  }

  return {
    subject: storedSubject,
    body: storedBody,
  };
}

function resolveFollowUpDraft(prospect, options = {}) {
  if (options.subject || options.body) {
    return {
      subject: compactText(options.subject) || baseFollowUpDraft(prospect, options.workspace).subject,
      body: compactMultilineText(options.body) || baseFollowUpDraft(prospect, options.workspace).body,
    };
  }

  return baseFollowUpDraft(prospect, options.workspace);
}

function updatedStoredInitialDraft(prospect, subject, body) {
  if (shouldUseStoredInitialDraft(prospect)) {
    return {
      draft_subject: subject,
      draft_body: body,
    };
  }

  return {
    draft_subject: prospect.draft_subject || subject,
    draft_body: prospect.draft_body || body,
  };
}

async function ensureProspectFollowUp(db, prospect, config, workspace = null) {
  const existing = await db.select('v2_prospect_follow_ups', {
    filters: [eq('prospect_id', prospect.id)],
    ordering: [order('step_number', 'asc')],
    limit: 5,
  }).catch(() => []);

  const dateKey = formatLocalDateKey(new Date(prospect.first_sent_at || prospect.last_sent_at || nowIso()), config.prospect_timezone);
  const offsets = Array.isArray(config.prospect_follow_up_offsets_days) && config.prospect_follow_up_offsets_days.length > 0
    ? config.prospect_follow_up_offsets_days
    : [Number(config.prospect_follow_up_delay_days || 3), 14];
  const createdRows = [];

  for (const [index, offset] of offsets.map((value) => Number(value || 0)).filter((value) => value > 0).entries()) {
    const stepNumber = index + 1;
    if (existing.some((row) => Number(row.step_number || 0) === stepNumber)) {
      continue;
    }

    const scheduledDateKey = addDaysToDateKey(dateKey, offset);
    const scheduledAt = zonedDateTimeToUtcIso(
      scheduledDateKey,
      config.prospect_follow_up_send_time || config.prospect_initial_send_time || '11:00',
      config.prospect_timezone || 'America/New_York',
    );
    const draft = buildProspectFollowUpDraft({ ...prospect, follow_up_step: stepNumber }, workspace);

    const [row] = await db.insert('v2_prospect_follow_ups', {
      prospect_id: prospect.id,
      step_number: stepNumber,
      scheduled_at: scheduledAt,
      draft_subject: draft.subject,
      draft_body: draft.body,
      status: 'pending',
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    if (row) {
      createdRows.push(row);
    }
  }

  return createdRows[0] || existing.find((row) => Number(row.step_number || 0) === 1) || null;
}

async function cancelProspectFollowUps(db, prospectId, reason = 'status_changed') {
  return db.update('v2_prospect_follow_ups', [eq('prospect_id', prospectId), eq('status', 'pending')], {
    status: 'cancelled',
    updated_at: nowIso(),
    slot_key: reason,
  }).catch(() => []);
}

async function recordProspectEvent(db, prospectId, eventType, actorType = 'system', actorId = null, detail = null) {
  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    detail,
    created_at: nowIso(),
  });
}

async function recordProspectOutcome(db, payload) {
  await db.insert('v2_prospect_outcomes', {
    created_at: nowIso(),
    ...payload,
  });
}

async function getProspectWithFollowUps(db, prospectId) {
  const [prospect, followUps] = await Promise.all([
    db.single('v2_prospects', { filters: [eq('id', prospectId)] }),
    db.select('v2_prospect_follow_ups', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('step_number', 'asc')],
    }).catch(() => []),
  ]);

  if (!prospect) {
    return { prospect: null, followUps: [] };
  }

  return { prospect, followUps };
}

async function sendProspectMessage(env, db, prospectId, options = {}) {
  const [{ prospect, followUps }, allProspects, outcomes, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    getProspectWithFollowUps(db, prospectId),
    listAllProspects(db),
    listRecentProspectOutcomes(db),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const kind = options.kind === 'follow_up' ? 'follow_up' : 'initial';
  const suppressedDomains = buildSuppressedDomainMap(allProspects, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);
  const linkedProspect = await syncProspectCrmLinkage(db, prospect, {
    campaignId: options.campaignId || prospect.campaign_id || null,
  });
  const hydrated = hydrateProspect(linkedProspect, {
    followUps,
    suppressedDomains,
    suppressionMaps,
    reviewMaps,
    companyMap,
    campaignMap,
  });
  const recipient = normalizeEmail(hydrated.email_address);

  if (!recipient) {
    throw new Error('Prospect does not have a valid email address');
  }

  if (isProspectSuppressed(hydrated)) {
    throw new Error('Prospect is suppressed and cannot receive automation');
  }

  if (pendingReviewReason(hydrated, reviewMaps)) {
    throw new Error('Prospect has a pending inbound reply review and cannot be auto-sent');
  }

  const domainSuppression = companySuppressionReason(hydrated, suppressedDomains);
  if (domainSuppression && !isProspectSuppressed(hydrated)) {
    await db.update('v2_prospects', [eq('id', prospectId)], {
      status: hydrated.first_sent_at ? hydrated.status : 'archived',
      updated_at: nowIso(),
    }).catch(() => []);
    await recordProspectEvent(db, prospectId, 'company_suppressed', options.actorType || 'system', options.actorId || null, {
      reason: domainSuppression,
      company_domain: companyDomainForProspect(hydrated),
    });
    throw new Error('Company domain is suppressed from further outreach');
  }

  if (kind === 'initial' && hydrated.first_sent_at) {
    throw new Error('Initial outreach already sent for this prospect');
  }

  const workspace = options.workspace || null;
  const { sender, replyTo } = resolveWorkspaceSender(env, workspace);

  if (kind === 'initial') {
    const priorOutreach = await getPriorOutreach(db, recipient);
    const sameProspect = priorOutreach?.prospect_id && String(priorOutreach.prospect_id) === String(prospectId);
    if (priorOutreach && !sameProspect) {
      await db.update('v2_prospects', [eq('id', prospectId)], {
        status: 'archived',
        updated_at: nowIso(),
      });
      await recordProspectOutcome(db, {
        prospect_id: prospectId,
        email_address: recipient,
        outcome: 'archived',
        detail: {
          reason: 'duplicate_initial_suppressed',
          prior_outcome: priorOutreach.outcome || null,
          prior_sent_at: priorOutreach.sent_at || priorOutreach.created_at || null,
          source_table: priorOutreach.source_table || null,
          kind: 'initial',
        },
      });
      await recordProspectEvent(db, prospectId, 'duplicate_initial_suppressed', options.actorType || 'system', options.actorId || null, {
        recipient,
        source_table: priorOutreach.source_table || null,
      });
      throw new Error(`${formatPriorOutreachMessage(priorOutreach)}. Prospect archived to prevent duplicate initial outreach.`);
    }
  }

  const resolvedInitialDraft = resolveInitialDraft(hydrated, workspace);
  const resolvedFollowUpDraft = kind === 'follow_up'
    ? resolveFollowUpDraft({ ...hydrated, follow_up_step: Number(options.stepNumber || 1) }, { ...options, workspace })
    : null;
  const draftSubject = kind === 'follow_up'
    ? resolvedFollowUpDraft?.subject || ''
    : compactText(options.subject) || resolvedInitialDraft.subject || '';
  const draftBody = kind === 'follow_up'
    ? resolvedFollowUpDraft?.body || ''
    : compactMultilineText(options.body) || resolvedInitialDraft.body || '';
  const normalizedDraftSubject = compactText(draftSubject);
  const normalizedDraftBody = compactMultilineText(draftBody);

  if (!normalizedDraftSubject || !normalizedDraftBody) {
    throw new Error('Prospect draft is empty. Refresh the draft before sending.');
  }

  const gmail = await sendAutomationEmail(env, {
    attachmentContentType: workspace?.attachment_content_type || undefined,
    attachmentFilename: workspace?.attachment_filename || undefined,
    attachmentKey: workspace?.attachment_kv_key || undefined,
    mailbox: workspace?.default_mailbox || null,
    recipient,
    replyTo,
    sender,
    senderName: workspaceSenderName(workspace),
    subject: normalizedDraftSubject,
    body: normalizedDraftBody,
    threadId: kind === 'follow_up' ? hydrated.gmail_thread_id || undefined : undefined,
  });

  const sentAt = nowIso();
  const nextPatch = {
    ...(kind === 'initial' ? updatedStoredInitialDraft(hydrated, normalizedDraftSubject, normalizedDraftBody) : {}),
    status: 'sent',
    first_sent_at: kind === 'initial' ? (hydrated.first_sent_at || sentAt) : hydrated.first_sent_at,
    last_sent_at: sentAt,
    last_follow_up_at: kind === 'follow_up' ? sentAt : hydrated.last_follow_up_at || null,
    sent_count: Number(hydrated.sent_count || 0) + 1,
    gmail_thread_id: gmail.threadId || hydrated.gmail_thread_id || null,
    updated_at: sentAt,
  };

  const [updated] = await db.update('v2_prospects', [eq('id', prospectId)], nextPatch);

  await recordProspectOutcome(db, {
    prospect_id: prospectId,
    email_address: recipient,
    outcome: 'sent',
    gmail_message_id: gmail.id || null,
    gmail_thread_id: gmail.threadId || hydrated.gmail_thread_id || null,
    detail: {
      kind,
      step_number: kind === 'follow_up' ? Number(options.stepNumber || 1) : 0,
      subject: normalizedDraftSubject,
      automated: Boolean(options.automated),
      slot_key: options.slotKey || null,
    },
    sent_at: sentAt,
  });

  await recordProspectEvent(
    db,
    prospectId,
    kind === 'follow_up' ? 'follow_up_sent' : 'sent',
    options.actorType || 'system',
    options.actorId || null,
    {
      recipient,
      subject: normalizedDraftSubject,
      slot_key: options.slotKey || null,
    },
  );

  if (kind === 'initial') {
    await ensureProspectFollowUp(db, {
      ...updated,
      first_sent_at: nextPatch.first_sent_at,
      last_sent_at: nextPatch.last_sent_at,
    }, options.config || await getAppConfig(db), workspace);
  }

  if (kind === 'follow_up' && options.followUpId) {
    await db.update('v2_prospect_follow_ups', [eq('id', options.followUpId)], {
      status: 'sent',
      sent_at: sentAt,
      slot_key: options.slotKey || null,
      draft_subject: normalizedDraftSubject,
      draft_body: normalizedDraftBody,
      updated_at: sentAt,
    });
  }

  return {
    success: true,
    recipient,
    sentAt,
    kind,
    prospect: hydrateProspect(updated, {
      followUps: kind === 'follow_up'
        ? followUps.map((row) => (String(row.id) === String(options.followUpId) ? { ...row, status: 'sent', sent_at: sentAt } : row))
        : followUps,
    }),
  };
}

export function formatProspectCategory(category) {
  return CATEGORY_LABELS[category] || 'Prospect';
}

export function buildProspectDraft(prospect, workspace = null) {
  return resolveInitialDraft(prospect, workspace);
}

export function buildProspectFollowUpDraft(prospect, workspace = null) {
  return resolveFollowUpDraft(prospect, { workspace });
}

function hydrateFollowUpItem(followUp, prospect) {
  return {
    ...followUp,
    category: prospect?.category || null,
    contact_name: prospect?.contact_name || null,
    company_name: prospect?.company_name || null,
    email_address: prospect?.email_address || null,
    queue_state: prospect ? deriveQueueState(prospect, [followUp]) : 'queued_follow_up',
  };
}

function sumCounter(counter) {
  return Object.values(counter || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function categoryMetricTemplate() {
  return Object.fromEntries(PROSPECT_CATEGORIES.map((category) => [category, {
    key: category,
    label: formatProspectCategory(category),
    category,
    contacts: 0,
    queued_initial: 0,
    follow_ups_due: 0,
    sent_today: 0,
    sent_total: 0,
    delivered_total: 0,
    replied_total: 0,
    opted_out_total: 0,
    bounced_total: 0,
    positive_replies: 0,
    suppressed_total: 0,
  }]));
}

export async function getProspectAutomationOverview(db, config = null) {
  const resolvedConfig = config || await getAppConfig(db);
  const timeZone = resolvedConfig.prospect_timezone || 'America/New_York';
  const todayKey = formatLocalDateKey(new Date(), timeZone);
  const [prospects, followUps, outcomes, events, recentImports, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    listAllProspects(db),
    listAllProspectFollowUps(db),
    listRecentProspectOutcomes(db),
    listRecentProspectEvents(db),
    db.select('v2_prospect_import_batches', {
      ordering: [order('created_at', 'desc')],
      limit: 12,
    }).catch(() => []),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);

  const prospectMap = Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect]));
  const suppressedDomains = buildSuppressedDomainMap(prospects, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);
  const followUpsByProspect = Object.fromEntries(
    prospects.map((prospect) => [prospect.id, findProspectFollowUps(followUps, prospect.id)]),
  );
  const initialSentToday = categoryCounter(0);
  const followUpSentToday = categoryCounter(0);
  const sentTodayByCategory = categoryCounter(0);
  const initialQueueByCategory = categoryCounter(0);
  const followUpDueByCategory = categoryCounter(0);
  const optOutsByCategory = categoryCounter(0);
  const deliveredByCategory = categoryCounter(0);
  const positiveRepliesByCategory = categoryCounter(0);
  const categoryMetrics = categoryMetricTemplate();
  const campaignMetrics = new Map(
    recentImports.map((batch) => [String(batch.id), {
      id: batch.id,
      filename: batch.filename,
      category: batch.category,
      imported_count: Number(batch.imported_count || 0),
      skipped_count: Number(batch.skipped_count || 0),
      created_at: batch.created_at,
      sent_total: 0,
      delivered_total: 0,
      replied_total: 0,
      positive_replies_total: 0,
      opted_out_total: 0,
      bounced_total: 0,
      contacts_total: 0,
    }]),
  );
  const campaignCatalogMetrics = new Map(
    campaignsCatalog.map((campaign) => [String(campaign.id), {
      id: campaign.id,
      name: campaign.name,
      category: campaign.category,
      status: campaign.status,
      daily_cap: Number(campaign.daily_cap || 10),
      send_time_local: campaign.send_time_local || '11:00',
      timezone: campaign.timezone || timeZone,
      contacts_total: 0,
      sent_total: 0,
      delivered_total: 0,
      replied_total: 0,
      positive_replies_total: 0,
      bounced_total: 0,
      suppressed_total: 0,
    }]),
  );
  const companyMetrics = new Map(
    companies.map((company) => [String(company.id), {
      id: company.id,
      name: company.name,
      domain: company.domain || null,
      website: company.website || null,
      category: company.category || null,
      suppressed: Boolean(company.suppressed),
      suppressed_reason: company.suppressed_reason || null,
      contact_count: 0,
      sent_total: 0,
      replied_total: 0,
      positive_replies_total: 0,
    }]),
  );

  let sentTotal = 0;
  let bouncedTotal = 0;
  let repliedTotal = 0;
  let optOutTotal = 0;
  let positiveRepliesTotal = 0;
  let suppressedTotal = 0;

  for (const prospect of prospects) {
    if (!PROSPECT_CATEGORIES.includes(prospect.category)) {
      continue;
    }

    categoryMetrics[prospect.category].contacts += 1;
    if (prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
      campaignMetrics.get(String(prospect.import_batch_id)).contacts_total += 1;
    }
    if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
      campaignCatalogMetrics.get(String(prospect.campaign_id)).contacts_total += 1;
    }
    if (prospect.company_id && companyMetrics.has(String(prospect.company_id))) {
      companyMetrics.get(String(prospect.company_id)).contact_count += 1;
    }

    const companySuppressed = companySuppressionReason(prospect, suppressedDomains);
    const explicitSuppression = explicitSuppressionReason(prospect, suppressionMaps);
    const pendingReview = pendingReviewReason(prospect, reviewMaps);
    if (prospect.status === 'opted_out' || prospect.do_not_contact || prospect.opted_out_at) {
      optOutsByCategory[prospect.category] += 1;
      categoryMetrics[prospect.category].opted_out_total += 1;
      optOutTotal += 1;
    }
    if (prospect.status === 'replied' || prospect.last_replied_at) {
      categoryMetrics[prospect.category].replied_total += 1;
      repliedTotal += 1;
    }
    if (isProspectSuppressed(prospect) || explicitSuppression || companySuppressed) {
      categoryMetrics[prospect.category].suppressed_total += 1;
      suppressedTotal += 1;
      if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
        campaignCatalogMetrics.get(String(prospect.campaign_id)).suppressed_total += 1;
      }
    }
    if (pendingReview) {
      categoryMetrics[prospect.category].suppressed_total += 0;
    }
  }

  for (const outcome of outcomes) {
    const prospect = prospectMap[outcome.prospect_id];
    if (!prospect || !PROSPECT_CATEGORIES.includes(prospect.category)) {
      continue;
    }

    const outcomeType = String(outcome.outcome || '').toLowerCase();
    if (outcomeType === 'sent') {
      sentTotal += 1;
      categoryMetrics[prospect.category].sent_total += 1;
      deliveredByCategory[prospect.category] += 1;
      categoryMetrics[prospect.category].delivered_total += 1;
      if (prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
        const campaign = campaignMetrics.get(String(prospect.import_batch_id));
        campaign.sent_total += 1;
        campaign.delivered_total += 1;
      }
      if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
        const campaign = campaignCatalogMetrics.get(String(prospect.campaign_id));
        campaign.sent_total += 1;
        campaign.delivered_total += 1;
      }
      if (prospect.company_id && companyMetrics.has(String(prospect.company_id))) {
        companyMetrics.get(String(prospect.company_id)).sent_total += 1;
      }
    }
    if (outcomeType === 'bounced') {
      bouncedTotal += 1;
      deliveredByCategory[prospect.category] = Math.max(0, deliveredByCategory[prospect.category] - 1);
      categoryMetrics[prospect.category].delivered_total = Math.max(0, categoryMetrics[prospect.category].delivered_total - 1);
      categoryMetrics[prospect.category].bounced_total += 1;
      if (prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
        const campaign = campaignMetrics.get(String(prospect.import_batch_id));
        campaign.bounced_total += 1;
        campaign.delivered_total = Math.max(0, campaign.delivered_total - 1);
      }
      if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
        const campaign = campaignCatalogMetrics.get(String(prospect.campaign_id));
        campaign.bounced_total += 1;
        campaign.delivered_total = Math.max(0, campaign.delivered_total - 1);
      }
    }
    if (outcomeType === 'replied') {
      if (prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
        campaignMetrics.get(String(prospect.import_batch_id)).replied_total += 1;
      }
      if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
        campaignCatalogMetrics.get(String(prospect.campaign_id)).replied_total += 1;
      }
      if (prospect.company_id && companyMetrics.has(String(prospect.company_id))) {
        companyMetrics.get(String(prospect.company_id)).replied_total += 1;
      }
    }

    if (outcomeType !== 'sent' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, timeZone)) {
      continue;
    }

    sentTodayByCategory[prospect.category] += 1;
    categoryMetrics[prospect.category].sent_today += 1;
    if (detailKind(outcome) === 'follow_up') {
      followUpSentToday[prospect.category] += 1;
    } else {
      initialSentToday[prospect.category] += 1;
    }
  }

  for (const event of events) {
    const prospect = prospectMap[event.prospect_id];
    if (!prospect || !PROSPECT_CATEGORIES.includes(prospect.category)) {
      continue;
    }
    if (event.event_type === 'positive_reply') {
      positiveRepliesTotal += 1;
      positiveRepliesByCategory[prospect.category] += 1;
      categoryMetrics[prospect.category].positive_replies += 1;
      if (prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
        campaignMetrics.get(String(prospect.import_batch_id)).positive_replies_total += 1;
      }
      if (prospect.campaign_id && campaignCatalogMetrics.has(String(prospect.campaign_id))) {
        campaignCatalogMetrics.get(String(prospect.campaign_id)).positive_replies_total += 1;
      }
      if (prospect.company_id && companyMetrics.has(String(prospect.company_id))) {
        companyMetrics.get(String(prospect.company_id)).positive_replies_total += 1;
      }
    }
    if (event.event_type === 'opted_out' && prospect.import_batch_id && campaignMetrics.has(String(prospect.import_batch_id))) {
      campaignMetrics.get(String(prospect.import_batch_id)).opted_out_total += 1;
    }
  }

  const initialQueue = [];
  const followUpQueue = [];
  const suppressedContacts = [];
  const pendingReviewQueue = [];
  const suppressionEntries = suppressions
    .filter((row) => row.active !== false)
    .slice(0, 25)
    .map((row) => ({
      id: row.id,
      scope_type: row.scope_type,
      scope_value: row.scope_value,
      reason: row.reason || null,
      source: row.source || null,
      active: row.active !== false,
      company_id: row.company_id || null,
      prospect_id: row.prospect_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
    }));

  for (const prospect of prospects) {
    const prospectFollowUps = followUpsByProspect[prospect.id] || [];
    const hydratedProspect = hydrateProspect(prospect, {
      followUps: prospectFollowUps,
      suppressedDomains,
      suppressionMaps,
      reviewMaps,
      companyMap,
      campaignMap,
    });

    if (!prospect.first_sent_at && !hydratedProspect.automation_block_reason && ['new', 'drafted'].includes(prospect.status)) {
      initialQueueByCategory[prospect.category] += 1;
      categoryMetrics[prospect.category].queued_initial += 1;
      initialQueue.push(hydratedProspect);
    }

    for (const followUp of prospectFollowUps) {
      if (followUp.status === 'pending' && !hydratedProspect.automation_block_reason) {
        followUpDueByCategory[prospect.category] += 1;
        categoryMetrics[prospect.category].follow_ups_due += 1;
        followUpQueue.push(hydrateFollowUpItem(followUp, hydratedProspect));
      }
    }

    if ((hydratedProspect.queue_state === 'suppressed' || hydratedProspect.queue_state === 'opted_out') && suppressedContacts.length < 20) {
      suppressedContacts.push({
        id: hydratedProspect.id,
        category: hydratedProspect.category,
        company_name: hydratedProspect.company_name,
        contact_name: hydratedProspect.contact_name,
        email_address: hydratedProspect.email_address,
        reason: hydratedProspect.automation_block_reason || hydratedProspect.queue_state,
        updated_at: hydratedProspect.updated_at,
      });
    }
    if (hydratedProspect.queue_state === 'pending_review' && pendingReviewQueue.length < 20) {
      const review = reviewMaps.byThreadId.get(String(hydratedProspect.gmail_thread_id || ''))
        || reviewMaps.byEmail.get(normalizeEmail(hydratedProspect.email_address));
      pendingReviewQueue.push({
        id: review?.id || hydratedProspect.id,
        prospect_id: hydratedProspect.id,
        category: hydratedProspect.category,
        company_name: hydratedProspect.company_name,
        contact_name: hydratedProspect.contact_name,
        email_address: hydratedProspect.email_address,
        reason: review?.reason || hydratedProspect.automation_block_reason || 'reply_review_pending',
        created_at: review?.created_at || hydratedProspect.updated_at,
        gmail_thread_id: review?.gmail_thread_id || hydratedProspect.gmail_thread_id || null,
      });
    }
  }

  const recentSends = outcomes
    .filter((outcome) => outcome.outcome === 'sent')
    .slice(0, 12)
    .map((outcome) => {
      const prospect = prospectMap[outcome.prospect_id];
      return {
        id: outcome.id,
        prospect_id: outcome.prospect_id,
        category: prospect?.category || null,
        contact_name: summaryLabel(prospect || { contact_name: null, company_name: null, email_address: outcome.email_address }),
        email_address: outcome.email_address,
        sent_at: outcome.sent_at || outcome.created_at,
        kind: detailKind(outcome) || 'initial',
      };
    });

  const exceptions = events
    .filter((event) => ['duplicate_initial_suppressed', 'opted_out', 'status_changed', 'company_suppressed', 'bounced'].includes(event.event_type))
    .slice(0, 12)
    .map((event) => {
      const prospect = prospectMap[event.prospect_id];
      return {
        id: event.id,
        prospect_id: event.prospect_id,
        label: summaryLabel(prospect || { contact_name: null, company_name: null, email_address: 'Prospect' }),
        category: prospect?.category || null,
        event_type: event.event_type,
        created_at: event.created_at,
      };
    });

  return {
    pilot_enabled: Boolean(resolvedConfig.prospect_pilot_enabled),
    permit_auto_send_enabled: Boolean(resolvedConfig.permit_auto_send_enabled),
    timezone: timeZone,
    initial_send_time: resolvedConfig.prospect_initial_send_time || '11:00',
    follow_up_send_time: resolvedConfig.prospect_follow_up_send_time || resolvedConfig.prospect_initial_send_time || '11:00',
    initial_daily_per_category: Number(resolvedConfig.prospect_daily_per_category || resolvedConfig.prospect_initial_daily_per_category || 10),
    follow_up_daily_per_category: Number(resolvedConfig.prospect_daily_per_category || resolvedConfig.prospect_follow_up_daily_per_category || 10),
    follow_up_delay_days: Number(Array.isArray(resolvedConfig.prospect_follow_up_offsets_days) ? resolvedConfig.prospect_follow_up_offsets_days[0] || 3 : resolvedConfig.prospect_follow_up_delay_days || 3),
    follow_up_offsets_days: Array.isArray(resolvedConfig.prospect_follow_up_offsets_days)
      ? resolvedConfig.prospect_follow_up_offsets_days.map((value) => Number(value || 0)).filter((value) => value > 0)
      : [Number(resolvedConfig.prospect_follow_up_delay_days || 3), 14],
    initial_sent_today: initialSentToday,
    follow_up_sent_today: followUpSentToday,
    sent_today_by_category: sentTodayByCategory,
    initial_queue_by_category: initialQueueByCategory,
    follow_up_due_by_category: followUpDueByCategory,
    opted_out_by_category: optOutsByCategory,
    positive_replies_by_category: positiveRepliesByCategory,
    suppressed_by_category: Object.fromEntries(PROSPECT_CATEGORIES.map((category) => [category, categoryMetrics[category].suppressed_total])),
    initial_queue: initialQueue.slice(0, 20),
    follow_up_queue: followUpQueue.slice(0, 20),
    recent_sends: recentSends,
    exceptions,
    metrics: {
      contacts_total: prospects.length,
      sent_total: sentTotal,
      delivered_total: Math.max(sentTotal - bouncedTotal, 0),
      replied_total: repliedTotal,
      positive_replies_total: positiveRepliesTotal,
      opted_out_total: optOutTotal,
      bounced_total: bouncedTotal,
      suppressed_total: suppressedTotal,
    },
    campaigns: PROSPECT_CATEGORIES.map((category) => categoryMetrics[category]),
    campaign_batches: [...campaignMetrics.values()],
    suppressed_contacts: suppressedContacts,
    suppression_entries: suppressionEntries,
    review_queue: pendingReviewQueue,
    companies: [...companyMetrics.values()]
      .sort((left, right) => right.contact_count - left.contact_count || right.sent_total - left.sent_total)
      .slice(0, 20),
    campaign_catalog: [...campaignCatalogMetrics.values()],
  };
}

export async function listProspects(db, options = {}) {
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
  const status = options.status || 'all';
  const category = options.category || 'all';
  const query = compactText(options.q)?.toLowerCase() || '';

  const config = await getAppConfig(db);
  const [allRows, recentImports, followUps, automation, companies, campaignsCatalog, suppressions, reviewQueue, outcomes] = await Promise.all([
    listAllProspects(db),
    db.select('v2_prospect_import_batches', {
      ordering: [order('created_at', 'desc')],
      limit: 8,
    }),
    listAllProspectFollowUps(db),
    getProspectAutomationOverview(db, config),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
    listRecentProspectOutcomes(db),
  ]);

  const counts = {
    all: allRows.length,
    new: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    opted_out: 0,
    archived: 0,
  };
  const categories = categoryCounter(0);
  const suppressedDomains = buildSuppressedDomainMap(allRows, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);
  const followUpsByProspect = Object.fromEntries(
    allRows.map((prospect) => [prospect.id, findProspectFollowUps(followUps, prospect.id)]),
  );

  for (const row of allRows) {
    if (counts[row.status] !== undefined) {
      counts[row.status] += 1;
    }
    if (categories[row.category] !== undefined) {
      categories[row.category] += 1;
    }
  }

  const filtered = allRows.filter((prospect) => {
    if (status !== 'all' && prospect.status !== status) {
      return false;
    }
    if (category !== 'all' && prospect.category !== category) {
      return false;
    }
    if (query) {
      const haystack = [
        prospect.contact_name,
        prospect.company_name,
        prospect.contact_role,
        prospect.email_address,
        prospect.website,
        prospect.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });

  const sorted = [...filtered]
    .sort((left, right) => Number(new Date(right.updated_at || 0).getTime()) - Number(new Date(left.updated_at || 0).getTime()))
    .slice((page - 1) * limit, page * limit)
    .map((prospect) => hydrateProspect(prospect, {
      followUps: followUpsByProspect[prospect.id] || [],
      suppressedDomains,
      suppressionMaps,
      reviewMaps,
      companyMap,
      campaignMap,
      workspace: options.workspace || null,
    }));

  return {
    prospects: sorted,
    page,
    limit,
    counts,
    categories,
    recent_imports: recentImports,
    follow_up_queue: automation.follow_up_queue,
    initial_queue: automation.initial_queue,
    automation,
  };
}

export async function getProspectDetail(db, prospectId, options = {}) {
  const [prospect, timeline, followUps, allProspects, outcomes, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    db.single('v2_prospects', { filters: [eq('id', prospectId)] }),
    db.select('v2_prospect_events', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('created_at', 'desc')],
      limit: 50,
    }),
    db.select('v2_prospect_follow_ups', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('step_number', 'asc')],
    }).catch(() => []),
    listAllProspects(db),
    listRecentProspectOutcomes(db),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);

  if (!prospect) {
    return null;
  }

  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);
  const hydrated = hydrateProspect(prospect, {
    followUps,
    suppressedDomains: buildSuppressedDomainMap(allProspects, outcomes),
    suppressionMaps,
    reviewMaps,
    companyMap,
    campaignMap,
    workspace: options.workspace || null,
  });
  const importBatch = hydrated.import_batch_id
    ? await db.single('v2_prospect_import_batches', { filters: [eq('id', hydrated.import_batch_id)] })
    : null;
  const suppressionRows = suppressions.filter((row) => {
    if (row.active === false) {
      return false;
    }
    const normalizedEmail = normalizeEmail(hydrated.email_address);
    const normalizedDomain = normalizeSuppressionScopeValue(companyDomainForProspect(hydrated));
    const normalizedCompany = normalizeCompanyNameKey(hydrated.company_name);

    if (row.prospect_id && String(row.prospect_id) === String(hydrated.id)) {
      return true;
    }
    if (row.scope_type === 'email' && normalizedEmail && normalizeSuppressionScopeValue(row.scope_value) === normalizedEmail) {
      return true;
    }
    if (row.scope_type === 'domain' && normalizedDomain && normalizeSuppressionScopeValue(row.scope_value) === normalizedDomain) {
      return true;
    }
    if (row.scope_type === 'company' && hydrated.company_id && String(row.company_id || '') === String(hydrated.company_id)) {
      return true;
    }
    return row.scope_type === 'company' && normalizedCompany && normalizeCompanyNameKey(row.scope_value) === normalizedCompany;
  });
  const reviewItems = reviewQueue.filter((row) => (
    row.status === 'pending'
    && (
      (row.target_email && normalizeEmail(row.target_email) === normalizeEmail(hydrated.email_address))
      || (row.sender_email && normalizeEmail(row.sender_email) === normalizeEmail(hydrated.email_address))
      || (row.gmail_thread_id && hydrated.gmail_thread_id && String(row.gmail_thread_id) === String(hydrated.gmail_thread_id))
    )
  ));

  return {
    prospect: hydrated,
    draft: {
      subject: hydrated.draft_subject,
      body: hydrated.draft_body,
    },
    timeline,
    import_batch: importBatch,
    follow_ups: followUps.map((followUp) => hydrateFollowUpItem(followUp, hydrated)),
    suppressions: suppressionRows,
    review_items: reviewItems,
  };
}

export async function importProspects(db, payload, actorId = null, workspace = null) {
  const filename = compactText(payload?.filename) || 'upload.csv';
  const category = PROSPECT_CATEGORIES.includes(payload?.category) ? payload.category : null;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (!category) {
    throw new Error('Choose a valid prospect category before importing');
  }

  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  const campaign = await ensureCampaignForCategory(db, category).catch(() => null);
  let batch;
  try {
    batch = (await db.insert('v2_prospect_import_batches', {
      filename,
      category,
      row_count: rows.length,
      actor_id: actorId,
      ...(campaign?.id ? { campaign_id: campaign.id } : {}),
    }))[0];
  } catch (error) {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    batch = (await db.insert('v2_prospect_import_batches', {
      filename,
      category,
      row_count: rows.length,
      actor_id: actorId,
    }))[0];
  }

  const skippedByReason = {
    missing_valid_email: 0,
    duplicate_in_file: 0,
    already_in_database: 0,
  };
  const seenEmails = new Set();
  const normalizedRows = [];

  for (const row of rows) {
    const result = normalizeProspectRowResult(row, category);
    if (!result.row) {
      skippedByReason[result.reason] += 1;
      continue;
    }

    if (seenEmails.has(result.row.email_normalized)) {
      skippedByReason.duplicate_in_file += 1;
      continue;
    }

    seenEmails.add(result.row.email_normalized);
    normalizedRows.push(result.row);
  }

  if (!normalizedRows.length) {
    const skipped = Object.values(skippedByReason).reduce((total, value) => total + Number(value || 0), 0);
    await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
      imported_count: 0,
      skipped_count: skipped,
      ...(campaign?.id ? { campaign_id: campaign.id } : {}),
      skipped_by_reason: skippedByReason,
    }).catch(async (error) => {
      if (!isMissingProspectCrmError(error)) {
        throw error;
      }
      await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
        imported_count: 0,
        skipped_count: skipped,
        ...(campaign?.id ? { campaign_id: campaign.id } : {}),
      });
    });
    return {
      batch_id: batch.id,
      filename,
      category,
      imported: 0,
      skipped,
      skipped_by_reason: skippedByReason,
    };
  }

  const existing = await db.select('v2_prospects', {
    filters: [inList('email_normalized', normalizedRows.map((row) => row.email_normalized))],
  });

  const existingMap = Object.fromEntries(existing.map((row) => [row.email_normalized, row]));
  const freshRows = [];

  for (const row of normalizedRows) {
    if (existingMap[row.email_normalized]) {
      skippedByReason.already_in_database += 1;
      continue;
    }

    freshRows.push(row);
  }

  const skipped = Object.values(skippedByReason).reduce((total, value) => total + Number(value || 0), 0);

  if (!freshRows.length) {
    await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
      imported_count: 0,
      skipped_count: skipped,
      ...(campaign?.id ? { campaign_id: campaign.id } : {}),
      skipped_by_reason: skippedByReason,
    }).catch(async (error) => {
      if (!isMissingProspectCrmError(error)) {
        throw error;
      }
      await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
        imported_count: 0,
        skipped_count: skipped,
        ...(campaign?.id ? { campaign_id: campaign.id } : {}),
      });
    });
    return {
      batch_id: batch.id,
      filename,
      category,
      imported: 0,
      skipped,
      skipped_by_reason: skippedByReason,
    };
  }

  const now = nowIso();

  const prepared = freshRows.map((row) => {
    const merged = {
      category: row.category,
      company_name: row.company_name,
      contact_name: row.contact_name,
      contact_role: row.contact_role,
      email_address: row.email_address,
      email_normalized: row.email_normalized,
      phone: row.phone,
      website: row.website,
      city: row.city,
      state: row.state,
      source: 'csv_import',
      import_batch_id: batch.id,
      campaign_id: campaign?.id || null,
      company_id: null,
      status: 'new',
      notes: row.notes,
      personalization_summary: firstDescriptionSnippet(row, 220),
      gmail_thread_id: null,
      sent_count: 0,
      do_not_contact: false,
      opted_out_at: null,
      first_sent_at: null,
      last_sent_at: null,
      last_follow_up_at: null,
      last_replied_at: null,
      created_at: now,
      updated_at: now,
    };
    const draft = buildProspectDraft(merged, workspace);

    return {
      ...merged,
      draft_subject: draft.subject,
      draft_body: draft.body,
    };
  });

  const imported = [];
  for (const group of chunk(prepared, 50)) {
    let rowsResult;
    try {
      rowsResult = await db.upsert('v2_prospects', group, 'email_normalized');
    } catch (error) {
      if (!isMissingProspectCrmError(error)) {
        throw error;
      }
      rowsResult = await db.upsert('v2_prospects', group.map((row) => {
        const {
          company_id,
          campaign_id,
          personalization_summary,
          ...legacyRow
        } = row;
        return legacyRow;
      }), 'email_normalized');
    }
    imported.push(...rowsResult);
  }

  const linked = [];
  for (const prospect of imported) {
    linked.push(await syncProspectCrmLinkage(db, {
      ...prospect,
      notes: prospect.notes,
      company_id: prospect.company_id || null,
      campaign_id: prospect.campaign_id || campaign?.id || null,
    }, {
      campaignId: campaign?.id || null,
    }));
  }

  const events = linked.map((prospect) => ({
    prospect_id: prospect.id,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: 'imported',
    detail: {
      batch_id: batch.id,
      filename,
      category,
    },
    created_at: nowIso(),
  }));

  await insertMany(db, 'v2_prospect_events', events);
  await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
    imported_count: linked.length,
    skipped_count: skipped,
    ...(campaign?.id ? { campaign_id: campaign.id } : {}),
    skipped_by_reason: skippedByReason,
  }).catch(async (error) => {
    if (!isMissingProspectCrmError(error)) {
      throw error;
    }
    await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
      imported_count: linked.length,
      skipped_count: skipped,
      ...(campaign?.id ? { campaign_id: campaign.id } : {}),
    });
  });

  return {
    batch_id: batch.id,
    filename,
    category,
    imported: linked.length,
    skipped,
    skipped_by_reason: skippedByReason,
  };
}

export async function saveProspectDraft(db, prospectId, draft, actorId = null, workspace = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const nextSubject = compactText(draft?.subject) || buildProspectDraft(prospect, workspace).subject;
  const nextBody = compactMultilineText(draft?.body) || buildProspectDraft(prospect, workspace).body;
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    draft_subject: nextSubject,
    draft_body: nextBody,
    status: prospect.status === 'new' ? 'drafted' : prospect.status,
    updated_at: nowIso(),
  }))[0];

  await recordProspectEvent(db, prospectId, 'draft_saved', 'operator', actorId, { subject: nextSubject });

  return hydrateProspect(updated, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
    workspace,
  });
}

export async function saveProspectNotes(db, prospectId, notes, actorId = null, workspace = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    notes: compactMultilineText(notes),
    updated_at: nowIso(),
  }))[0];

  await recordProspectEvent(db, prospectId, 'notes_updated', 'operator', actorId, null);

  const linked = await syncProspectCrmLinkage(db, updated);

  return hydrateProspect(linked, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
    workspace,
  });
}

export async function updateProspectStatus(db, prospectId, status, actorId = null, actorType = 'operator', detail = null) {
  if (!PROSPECT_STATUSES.includes(status)) {
    throw new Error('Invalid prospect status');
  }

  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = nowIso();
  const patch = {
    status,
    do_not_contact: status === 'opted_out' ? true : Boolean(prospect.do_not_contact),
    opted_out_at: status === 'opted_out' ? now : prospect.opted_out_at || null,
    last_replied_at: status === 'replied' ? now : prospect.last_replied_at || null,
    updated_at: now,
  };

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], patch))[0];
  if (status === 'replied' || status === 'opted_out' || status === 'archived') {
    await cancelProspectFollowUps(db, prospectId, status);
  }

  const linked = await syncProspectCrmLinkage(db, updated || prospect);

  if (status === 'opted_out') {
    await recordProspectOutcome(db, {
      prospect_id: prospectId,
      email_address: prospect.email_address,
      outcome: 'archived',
      detail: { kind: 'opted_out' },
    });
    await syncDerivedSuppressions(db, linked, 'opted_out', actorType === 'operator' ? 'operator' : 'system', actorId);
  }

  if (status === 'replied') {
    await syncDerivedSuppressions(db, linked, 'replied', actorType === 'operator' ? 'operator' : 'system', actorId);
  }

  await recordProspectEvent(
    db,
    prospectId,
    status === 'opted_out' ? 'opted_out' : 'status_changed',
    actorType,
    actorId,
    { status, ...(detail && typeof detail === 'object' ? detail : {}) },
  );

  if (status === 'opted_out' || status === 'replied') {
    await resolvePendingReviewItemsForProspect(db, linked, status, actorId);
  }

  return hydrateProspect(linked, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function optOutProspect(db, prospectId, actorId = null, actorType = 'operator', detail = null) {
  return updateProspectStatus(db, prospectId, 'opted_out', actorId, actorType, detail);
}

export async function markProspectReply(db, prospectId, actorId = null, tone = 'neutral', actorType = 'operator', detail = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = nowIso();
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    status: 'replied',
    do_not_contact: true,
    last_replied_at: now,
    updated_at: now,
  }))[0];
  const linked = await syncProspectCrmLinkage(db, updated || prospect);

  await cancelProspectFollowUps(db, prospectId, 'replied');
  await syncDerivedSuppressions(db, linked, tone === 'positive' ? 'positive_reply' : 'replied', actorType === 'operator' ? 'operator' : 'system', actorId);
  await recordProspectOutcome(db, {
    prospect_id: prospectId,
    email_address: prospect.email_address,
    outcome: 'replied',
    detail: { tone },
  });
  await recordProspectEvent(
    db,
    prospectId,
    tone === 'positive' ? 'positive_reply' : 'replied',
    actorType,
    actorId,
    { tone, ...(detail && typeof detail === 'object' ? detail : {}) },
  );

  await resolvePendingReviewItemsForProspect(db, linked, tone === 'positive' ? 'mark_positive_reply' : 'mark_reply', actorId);

  return hydrateProspect(linked, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function markProspectBounced(db, prospectId, actorId = null, actorType = 'operator', detail = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = nowIso();
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    status: 'archived',
    do_not_contact: true,
    updated_at: now,
  }))[0];
  const linked = await syncProspectCrmLinkage(db, updated || prospect);

  await cancelProspectFollowUps(db, prospectId, 'bounced');
  await syncDerivedSuppressions(db, linked, 'bounced', actorType === 'operator' ? 'operator' : 'system', actorId);
  await recordProspectOutcome(db, {
    prospect_id: prospectId,
    email_address: prospect.email_address,
    outcome: 'bounced',
    detail: { source: 'operator' },
  });
  await recordProspectEvent(db, prospectId, 'bounced', actorType, actorId, detail);

  await resolvePendingReviewItemsForProspect(db, linked, 'mark_bounced', actorId);

  return hydrateProspect(linked, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function sendProspect(env, db, prospectId, actorId = null, workspace = null) {
  const { prospect, followUps } = await getProspectWithFollowUps(db, prospectId);
  const kind = prospect?.first_sent_at ? 'follow_up' : 'initial';
  const pendingFollowUp = followUps.find((row) => row.status === 'pending') || null;

  return sendProspectMessage(env, db, prospectId, {
    kind,
    actorId,
    actorType: 'operator',
    followUpId: kind === 'follow_up' ? pendingFollowUp?.id || null : null,
    stepNumber: kind === 'follow_up' ? Number(pendingFollowUp?.step_number || 1) : 0,
    config: await getAppConfig(db),
    workspace,
  });
}

function byCreatedAtAsc(left, right) {
  return Number(new Date(left?.created_at || 0).getTime()) - Number(new Date(right?.created_at || 0).getTime());
}

function byScheduledAtAsc(left, right) {
  return Number(new Date(left?.scheduled_at || 0).getTime()) - Number(new Date(right?.scheduled_at || 0).getTime());
}

async function findSlotDuplicateRun(db, mode, slotKey) {
  const recentRuns = await db.select('v2_automation_runs', {
    ordering: [order('created_at', 'desc')],
    limit: 40,
  });

  return recentRuns.find((run) => {
    const scope = run?.source_scope && typeof run.source_scope === 'object' && !Array.isArray(run.source_scope)
      ? run.source_scope
      : {};
    return scope.mode === mode && scope.slot_key === slotKey && ['running', 'completed'].includes(run.status);
  }) || null;
}

function canQueueInitialProspect(prospect) {
  return prospect && !prospect.first_sent_at && !isProspectSuppressed(prospect) && ['new', 'drafted'].includes(prospect.status);
}

function sentTodayByCategory(outcomes, prospectMap, timeZone) {
  const todayKey = formatLocalDateKey(new Date(), timeZone);
  const totals = categoryCounter(0);

  for (const outcome of outcomes) {
    if (String(outcome.outcome || '').toLowerCase() !== 'sent' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, timeZone)) {
      continue;
    }
    const prospect = prospectMap[outcome.prospect_id];
    if (prospect && totals[prospect.category] !== undefined) {
      totals[prospect.category] += 1;
    }
  }

  return totals;
}

export async function runProspectDailyBatch(env, db, config, slotKey, options = {}) {
  const [followUps, prospects, outcomes, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    listAllProspectFollowUps(db),
    listAllProspects(db),
    listRecentProspectOutcomes(db),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);

  const prospectMap = Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect]));
  const suppressedDomains = buildSuppressedDomainMap(prospects, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);
  const attemptedByCategory = categoryCounter(0);
  const sentByCategory = categoryCounter(0);
  const skippedByCategory = categoryCounter(0);
  const initialSentByCategory = categoryCounter(0);
  const followUpSentByCategory = categoryCounter(0);
  const sentToday = sentTodayByCategory(outcomes, prospectMap, config.prospect_timezone);
  const totalPerCategory = Number(config.prospect_daily_per_category || config.prospect_initial_daily_per_category || 10);

  const dueFollowUps = followUps
    .filter((followUp) => {
      if (followUp.status !== 'pending' || new Date(followUp.scheduled_at).getTime() > Date.now()) {
        return false;
      }
      const prospect = prospectMap[followUp.prospect_id];
      if (!prospect) {
        return false;
      }
      const hydrated = hydrateProspect(prospect, {
        followUps: [followUp],
        suppressedDomains,
        suppressionMaps,
        reviewMaps,
        companyMap,
        campaignMap,
      });
      return !hydrated.automation_block_reason;
    })
    .sort(byScheduledAtAsc);
  const queuedInitials = prospects
    .filter((prospect) => {
      if (!canQueueInitialProspect(prospect)) {
        return false;
      }
      const hydrated = hydrateProspect(prospect, {
        followUps: [],
        suppressedDomains,
        suppressionMaps,
        reviewMaps,
        companyMap,
        campaignMap,
      });
      return !hydrated.automation_block_reason;
    })
    .sort(byCreatedAtAsc);

  const selectedFollowUps = [];
  const selectedInitials = [];

  for (const category of PROSPECT_CATEGORIES) {
    const remaining = options.ignoreDailyCap
      ? totalPerCategory
      : Math.max(totalPerCategory - Number(sentToday[category] || 0), 0);
    if (remaining <= 0) {
      continue;
    }

    const categoryFollowUps = dueFollowUps
      .filter((followUp) => prospectMap[followUp.prospect_id]?.category === category)
      .slice(0, remaining);
    selectedFollowUps.push(...categoryFollowUps);

    const leftAfterFollowUps = Math.max(remaining - categoryFollowUps.length, 0);
    if (leftAfterFollowUps > 0) {
      selectedInitials.push(...queuedInitials.filter((prospect) => prospect.category === category).slice(0, leftAfterFollowUps));
    }
  }

  for (const followUp of selectedFollowUps) {
    const prospect = prospectMap[followUp.prospect_id];
    if (!prospect) {
      continue;
    }

    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'follow_up',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        stepNumber: Number(followUp.step_number || 1),
        followUpId: followUp.id,
        config,
        workspace: options.workspace || null,
      });
      sentByCategory[prospect.category] += 1;
      followUpSentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'follow_up_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Follow-up automation skipped'),
      });
    }
  }

  for (const prospect of selectedInitials) {
    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'initial',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        config,
        workspace: options.workspace || null,
      });
      sentByCategory[prospect.category] += 1;
      initialSentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'initial_send_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Initial automation skipped'),
      });
    }
  }

  return {
    attempted_by_category: attemptedByCategory,
    sent_by_category: sentByCategory,
    skipped_by_category: skippedByCategory,
    initial_sent_by_category: initialSentByCategory,
    follow_up_sent_by_category: followUpSentByCategory,
    selected_count: selectedInitials.length + selectedFollowUps.length,
    selected_initial_count: selectedInitials.length,
    selected_follow_up_count: selectedFollowUps.length,
  };
}

export async function runProspectInitialBatch(env, db, config, slotKey, options = {}) {
  const [prospects, outcomes, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    listAllProspects(db),
    listRecentProspectOutcomes(db),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);
  const attemptedByCategory = categoryCounter(0);
  const sentByCategory = categoryCounter(0);
  const skippedByCategory = categoryCounter(0);
  const todayKey = formatLocalDateKey(new Date(), config.prospect_timezone);
  const sentTodayByCategory = categoryCounter(0);
  const suppressedDomains = buildSuppressedDomainMap(prospects, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);

  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent' || detailKind(outcome) === 'follow_up' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, config.prospect_timezone)) {
      continue;
    }
    const prospect = prospects.find((row) => String(row.id) === String(outcome.prospect_id));
    if (prospect && sentTodayByCategory[prospect.category] !== undefined) {
      sentTodayByCategory[prospect.category] += 1;
    }
  }

  const queued = prospects.filter((prospect) => {
    if (!canQueueInitialProspect(prospect)) {
      return false;
    }
    const hydrated = hydrateProspect(prospect, {
      followUps: [],
      suppressedDomains,
      suppressionMaps,
      reviewMaps,
      companyMap,
      campaignMap,
    });
    return !hydrated.automation_block_reason;
  }).sort(byCreatedAtAsc);
  const selected = [];
  for (const category of PROSPECT_CATEGORIES) {
    const remaining = Math.max(Number(config.prospect_initial_daily_per_category || 10) - Number(sentTodayByCategory[category] || 0), 0);
    if (remaining <= 0) {
      continue;
    }
    selected.push(...queued.filter((prospect) => prospect.category === category).slice(0, remaining));
  }

  for (const prospect of selected) {
    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'initial',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        config,
        workspace: options.workspace || null,
      });
      sentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'initial_send_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Initial automation skipped'),
      });
    }
  }

  return {
    attempted_by_category: attemptedByCategory,
    sent_by_category: sentByCategory,
    skipped_by_category: skippedByCategory,
    selected_count: selected.length,
  };
}

export async function runProspectFollowUpBatch(env, db, config, slotKey, options = {}) {
  const [followUps, prospects, outcomes, companies, campaignsCatalog, suppressions, reviewQueue] = await Promise.all([
    listAllProspectFollowUps(db),
    listAllProspects(db),
    listRecentProspectOutcomes(db),
    listProspectCompanies(db),
    listProspectCampaigns(db),
    listProspectSuppressions(db),
    listOutreachReviewQueue(db),
  ]);

  const prospectMap = Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect]));
  const attemptedByCategory = categoryCounter(0);
  const sentByCategory = categoryCounter(0);
  const skippedByCategory = categoryCounter(0);
  const todayKey = formatLocalDateKey(new Date(), config.prospect_timezone);
  const sentTodayByCategory = categoryCounter(0);
  const suppressedDomains = buildSuppressedDomainMap(prospects, outcomes);
  const suppressionMaps = buildSuppressionMaps(suppressions);
  const reviewMaps = buildReviewMaps(reviewQueue);
  const companyMap = buildCompanyMap(companies);
  const campaignMap = buildCampaignMap(campaignsCatalog);

  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent' || detailKind(outcome) !== 'follow_up' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, config.prospect_timezone)) {
      continue;
    }
    const prospect = prospectMap[outcome.prospect_id];
    if (prospect && sentTodayByCategory[prospect.category] !== undefined) {
      sentTodayByCategory[prospect.category] += 1;
    }
  }

  const due = followUps
    .filter((followUp) => {
      if (followUp.status !== 'pending' || new Date(followUp.scheduled_at).getTime() > Date.now()) {
        return false;
      }
      const prospect = prospectMap[followUp.prospect_id];
      if (!prospect) {
        return false;
      }
      const hydrated = hydrateProspect(prospect, {
        followUps: [followUp],
        suppressedDomains,
        suppressionMaps,
        reviewMaps,
        companyMap,
        campaignMap,
      });
      return !hydrated.automation_block_reason;
    })
    .sort(byScheduledAtAsc);

  const selected = [];
  for (const category of PROSPECT_CATEGORIES) {
    const remaining = Math.max(Number(config.prospect_follow_up_daily_per_category || 10) - Number(sentTodayByCategory[category] || 0), 0);
    if (remaining <= 0) {
      continue;
    }
    selected.push(...due.filter((followUp) => prospectMap[followUp.prospect_id]?.category === category).slice(0, remaining));
  }

  for (const followUp of selected) {
    const prospect = prospectMap[followUp.prospect_id];
    if (!prospect) {
      continue;
    }

    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'follow_up',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        stepNumber: Number(followUp.step_number || 1),
        followUpId: followUp.id,
        config,
        workspace: options.workspace || null,
      });
      sentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'follow_up_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Follow-up automation skipped'),
      });
    }
  }

  return {
    attempted_by_category: attemptedByCategory,
    sent_by_category: sentByCategory,
    skipped_by_category: skippedByCategory,
    selected_count: selected.length,
  };
}

export async function runScheduledProspectPilot(env, db, createRun, completeRun, failRun, options = {}) {
  const config = await getAppConfig(db);
  if (!config.prospect_pilot_enabled) {
    return { started: false, reason: 'prospect_pilot_disabled' };
  }

  const mode = options.mode || 'prospect_daily_send';
  const slotKey = options.slotKey;
  const existingRun = slotKey ? await findSlotDuplicateRun(db, mode, slotKey) : null;
  if (existingRun) {
    return { started: false, reason: 'slot_already_processed', run: existingRun };
  }

  const run = await createRun(
    db,
    'schedule',
    null,
    config,
    {
      mode,
      slot_key: slotKey,
      time_zone: config.prospect_timezone,
      progress: {
        backlog_pending: 0,
        claimed: 0,
        processed: 0,
        fresh_inserted: 0,
        remaining: 0,
      },
    },
    { initialStage: 'prospect_daily_queue' },
  );

  try {
    let summary;

    if (mode === 'prospect_initial_send') {
      summary = await runProspectInitialBatch(env, db, config, slotKey, options);
    } else if (mode === 'prospect_follow_up_send') {
      summary = await runProspectFollowUpBatch(env, db, config, slotKey, options);
    } else {
      summary = await runProspectDailyBatch(env, db, config, slotKey, options);
    }

    await completeRun(db, run.id, {
      sends_attempted: Object.values(summary.attempted_by_category).reduce((total, value) => total + Number(value || 0), 0),
      sends_succeeded: Object.values(summary.sent_by_category).reduce((total, value) => total + Number(value || 0), 0),
      sends_failed: Object.values(summary.skipped_by_category).reduce((total, value) => total + Number(value || 0), 0),
    }, {
      source_scope: {
        mode,
        slot_key: slotKey,
        per_category: summary,
      },
    });

    return {
      started: true,
      run,
      summary,
    };
  } catch (error) {
    await failRun(db, run.id, error, {}, {
      source_scope: {
        mode,
        slot_key: slotKey,
      },
    });
    throw error;
  }
}
