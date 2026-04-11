import { listRecentInboxMessages } from '../gmail.mjs';
import { appendLeadEvent } from './events.mjs';
import { markLeadOutcome } from '../pipeline/outcomes.mjs';
import {
  markProspectBounced,
  markProspectReply,
  optOutProspect,
  queueOutreachReviewItem,
} from './prospects.mjs';
import { eq, gte, order, withTenantScope } from './supabase.mjs';
import { getTenantGmailCredential, listTenants, METROGLASS_TENANT_ID } from './tenants.mjs';

const SUMMARY_PREFIX = 'reply_sync:summary:';
const SEEN_PREFIX = 'reply_sync:seen:';

const OPT_OUT_PATTERNS = [
  /take me off/i,
  /remove me/i,
  /remove us/i,
  /unsubscribe/i,
  /do not contact/i,
  /don't contact/i,
  /stop emailing/i,
  /stop reaching out/i,
  /please stop/i,
  /not interested/i,
];

const POSITIVE_PATTERNS = [
  /\binterested\b/i,
  /\bwould love\b/i,
  /\blet'?s\b/i,
  /\bschedule\b/i,
  /\bcall\b/i,
  /\bquote\b/i,
  /\bestimate\b/i,
  /\bpricing\b/i,
  /\bplease send\b/i,
  /\bhappy to\b/i,
  /\byes\b/i,
];

const BOUNCE_PATTERNS = [
  /mail delivery subsystem/i,
  /mailer-daemon/i,
  /delivery status notification/i,
  /undeliverable/i,
  /delivery has failed/i,
  /couldn't be delivered/i,
  /address not found/i,
  /recipient address rejected/i,
  /message blocked/i,
  /550 5\.1\.1/i,
];

const AUTO_REPLY_PATTERNS = [
  /automatic reply/i,
  /auto[ -]?reply/i,
  /out of office/i,
  /out of the office/i,
  /vacation responder/i,
  /away from the office/i,
  /i am currently away/i,
];

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value) {
  const email = compactText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeDomain(value) {
  const email = normalizeEmail(value);
  if (!email || !email.includes('@')) {
    return null;
  }
  return email.split('@').pop() || null;
}

function summaryKey(tenantId) {
  return `${SUMMARY_PREFIX}${tenantId}`;
}

function seenKey(tenantId, messageId) {
  return `${SEEN_PREFIX}${tenantId}:${messageId}`;
}

function bodyForClassification(message) {
  return compactText([message.subject, message.snippet, message.bodyText].filter(Boolean).join(' '));
}

function classifyInboundReply(message) {
  const text = bodyForClassification(message);
  const sender = compactText(message.from || message.fromEmail).toLowerCase();

  if (!text) {
    return 'reply';
  }
  if (BOUNCE_PATTERNS.some((pattern) => pattern.test(text)) || /mailer-daemon|postmaster/i.test(sender)) {
    return 'bounce';
  }
  if (AUTO_REPLY_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'review';
  }
  if (OPT_OUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'opt_out';
  }
  if (POSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'positive';
  }
  return 'reply';
}

function kvAvailable(env) {
  return Boolean(env?.PERMIT_PULSE?.get && env?.PERMIT_PULSE?.put);
}

async function hasSeenMessage(env, tenantId, messageId) {
  if (!kvAvailable(env) || !tenantId || !messageId) {
    return false;
  }
  return Boolean(await env.PERMIT_PULSE.get(seenKey(tenantId, messageId)));
}

async function markMessageSeen(env, tenantId, messageId) {
  if (!kvAvailable(env) || !tenantId || !messageId) {
    return;
  }
  await env.PERMIT_PULSE.put(seenKey(tenantId, messageId), '1', { expirationTtl: 60 * 60 * 24 * 60 });
}

async function writeSummary(env, tenantId, summary) {
  if (!kvAvailable(env) || !tenantId) {
    return summary;
  }
  await env.PERMIT_PULSE.put(summaryKey(tenantId), JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 60 });
  return summary;
}

export async function readReplySyncState(env, tenantId = null) {
  if (!kvAvailable(env) || !tenantId) {
    return null;
  }
  const value = await env.PERMIT_PULSE.get(summaryKey(tenantId));
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function listCandidateProspects(db) {
  return db.select('v2_prospects', {
    ordering: [order('updated_at', 'desc')],
    limit: 3000,
  }).catch(() => []);
}

async function listCandidateLeads(db) {
  const since = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString();
  return db.select('v2_leads', {
    columns: 'id,status,company_name,address,contact_email,fallback_email,updated_at,sent_at',
    filters: [eq('status', 'sent'), gte('sent_at', since)],
    ordering: [order('sent_at', 'desc')],
    limit: 3000,
  }).catch(() => []);
}

function buildProspectEmailMap(prospects) {
  const byEmail = new Map();
  const byThreadId = new Map();

  for (const prospect of prospects || []) {
    const email = normalizeEmail(prospect.email_address);
    if (email && !byEmail.has(email)) {
      byEmail.set(email, prospect);
    }
    if (prospect.gmail_thread_id) {
      byThreadId.set(String(prospect.gmail_thread_id), prospect);
    }
  }

  return { byEmail, byThreadId };
}

function buildLeadEmailMap(leads) {
  const byEmail = new Map();

  for (const lead of leads || []) {
    const emails = [lead.contact_email, lead.fallback_email]
      .map((value) => normalizeEmail(value))
      .filter(Boolean);
    for (const email of emails) {
      if (!byEmail.has(email)) {
        byEmail.set(email, lead);
      }
    }
  }

  return byEmail;
}

function allKnownEmails(prospects, leads) {
  const emails = new Set();
  for (const prospect of prospects || []) {
    const email = normalizeEmail(prospect.email_address);
    if (email) {
      emails.add(email);
    }
  }
  for (const lead of leads || []) {
    for (const value of [lead.contact_email, lead.fallback_email]) {
      const email = normalizeEmail(value);
      if (email) {
        emails.add(email);
      }
    }
  }
  return emails;
}

function referencedEmailFromMessage(message, knownEmails) {
  const text = bodyForClassification(message);
  if (!text) {
    return null;
  }
  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  for (const value of matches) {
    const email = normalizeEmail(value);
    if (email && knownEmails.has(email)) {
      return email;
    }
  }
  return null;
}

function detailPayload(message, extra = {}) {
  return {
    source: 'gmail_reply_sync',
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    sender_email: message.fromEmail,
    sender_domain: normalizeDomain(message.fromEmail),
    subject: message.subject || null,
    snippet: message.snippet || null,
    body_preview: compactText(message.bodyText || '').slice(0, 600) || null,
    received_at: message.internalDate || null,
    ...extra,
  };
}

async function applyProspectReply(db, prospect, classification, message) {
  const detail = detailPayload(message);

  if (classification === 'bounce') {
    await markProspectBounced(db, prospect.id, null, 'system', detail);
    return 'bounce';
  }

  if (classification === 'opt_out') {
    await optOutProspect(db, prospect.id, null, 'system', detail);
    return 'opt_out';
  }

  await markProspectReply(db, prospect.id, null, classification === 'positive' ? 'positive' : 'neutral', 'system', detail);
  return classification === 'positive' ? 'positive' : 'reply';
}

async function applyLeadReply(db, lead, classification, message) {
  const detail = detailPayload(message);

  if (classification === 'bounce') {
    await markLeadOutcome(db, lead.id, { outcome: 'bounced' });
    await appendLeadEvent(db, {
      lead_id: lead.id,
      event_type: 'bounce_detected',
      actor_type: 'system',
      actor_id: null,
      detail,
    });
    return 'bounce';
  }

  if (classification === 'opt_out') {
    await markLeadOutcome(db, lead.id, { outcome: 'replied' });
    await appendLeadEvent(db, {
      lead_id: lead.id,
      event_type: 'opt_out_detected',
      actor_type: 'system',
      actor_id: null,
      detail,
    });
    return 'opt_out';
  }

  await markLeadOutcome(db, lead.id, { outcome: 'replied' });
  await appendLeadEvent(db, {
    lead_id: lead.id,
    event_type: classification === 'positive' ? 'positive_reply_detected' : 'reply_detected',
    actor_type: 'system',
    actor_id: null,
    detail,
  });
  return classification === 'positive' ? 'positive' : 'reply';
}

async function queueReview(db, message, prospect = null, reason = 'reply_review_pending') {
  return queueOutreachReviewItem(db, {
    review_kind: reason.includes('bounce') ? 'bounce' : 'reply',
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId || null,
    sender_email: message.fromEmail || null,
    target_email: prospect?.email_address || null,
    classification: classifyInboundReply(message),
    reason,
    subject: message.subject || null,
    snippet: message.snippet || null,
    payload: {
      prospect_id: prospect?.id || null,
      company_id: prospect?.company_id || null,
      body_preview: compactText(message.bodyText || '').slice(0, 600) || null,
      received_at: message.internalDate || null,
    },
  });
}

async function canSyncTenant(env, db, tenant) {
  if (!tenant?.id || !tenant?.sender_email) {
    return false;
  }

  const credential = await getTenantGmailCredential(withTenantScope(db, tenant.id), tenant.id);
  return Boolean(credential?.refresh_token_encrypted || (tenant.id === METROGLASS_TENANT_ID && env.GMAIL_REFRESH_TOKEN));
}

async function syncTenantReplies(env, db, tenant, options = {}) {
  const tenantDb = withTenantScope(db, tenant.id);
  const maxResults = Math.min(Math.max(Number(options.maxResults || 0), 1), 100);
  const newerThanDays = Math.min(Math.max(Number(options.newerThanDays || 0), 1), 45);

  const [messages, prospects, leads] = await Promise.all([
    listRecentInboxMessages(env, tenantDb, tenant, { maxResults, newerThanDays, includeBody: true }),
    listCandidateProspects(tenantDb),
    listCandidateLeads(tenantDb),
  ]);

  const prospectMaps = buildProspectEmailMap(prospects);
  const leadEmailMap = buildLeadEmailMap(leads);
  const knownEmails = allKnownEmails(prospects, leads);

  const summary = {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    checked_at: new Date().toISOString(),
    scanned_messages: messages.length,
    processed_messages: 0,
    prospect_replies: 0,
    lead_replies: 0,
    opt_outs: 0,
    positive_replies: 0,
    unmatched_messages: 0,
    bounces: 0,
    review_items: 0,
  };

  for (const message of messages) {
    if (!message?.id) {
      continue;
    }
    if (await hasSeenMessage(env, tenant.id, message.id)) {
      continue;
    }

    const classification = classifyInboundReply(message);
    const referencedEmail = referencedEmailFromMessage(message, knownEmails);
    const prospect = prospectMaps.byThreadId.get(String(message.threadId || ''))
      || prospectMaps.byEmail.get(normalizeEmail(message.fromEmail))
      || (referencedEmail ? prospectMaps.byEmail.get(referencedEmail) : null);
    const lead = leadEmailMap.get(normalizeEmail(message.fromEmail))
      || (referencedEmail ? leadEmailMap.get(referencedEmail) : null);

    if (classification === 'review') {
      await queueReview(tenantDb, message, prospect, 'auto_reply_review');
      summary.processed_messages += 1;
      summary.review_items += 1;
      await markMessageSeen(env, tenant.id, message.id);
      continue;
    }

    if (prospect) {
      const applied = await applyProspectReply(tenantDb, prospect, classification, message);
      summary.processed_messages += 1;
      summary.prospect_replies += 1;
      if (applied === 'opt_out') summary.opt_outs += 1;
      if (applied === 'positive') summary.positive_replies += 1;
      if (applied === 'bounce') summary.bounces += 1;
      await markMessageSeen(env, tenant.id, message.id);
      continue;
    }

    if (lead) {
      const applied = await applyLeadReply(tenantDb, lead, classification, message);
      summary.processed_messages += 1;
      summary.lead_replies += 1;
      if (applied === 'opt_out') summary.opt_outs += 1;
      if (applied === 'positive') summary.positive_replies += 1;
      if (applied === 'bounce') summary.bounces += 1;
      await markMessageSeen(env, tenant.id, message.id);
      continue;
    }

    if (classification === 'bounce' || classification === 'reply' || classification === 'positive' || classification === 'opt_out') {
      await queueReview(tenantDb, message, null, classification === 'bounce' ? 'bounce_review_pending' : 'unmatched_reply_review');
      summary.review_items += 1;
      summary.processed_messages += 1;
    } else {
      summary.unmatched_messages += 1;
    }

    await markMessageSeen(env, tenant.id, message.id);
  }

  await writeSummary(env, tenant.id, summary);
  return summary;
}

export async function syncOutreachReplies(env, db, options = {}) {
  const allTenants = options.tenantId
    ? (await listTenants(db)).filter((tenant) => String(tenant.id) === String(options.tenantId))
    : await listTenants(db);

  const tenantSummaries = {};
  const aggregate = {
    checked_at: new Date().toISOString(),
    scanned_messages: 0,
    processed_messages: 0,
    prospect_replies: 0,
    lead_replies: 0,
    opt_outs: 0,
    positive_replies: 0,
    unmatched_messages: 0,
    bounces: 0,
    review_items: 0,
  };

  for (const tenant of allTenants) {
    if (!(await canSyncTenant(env, db, tenant))) {
      continue;
    }

    try {
      const summary = await syncTenantReplies(env, db, tenant, options);
      tenantSummaries[tenant.slug] = summary;
      for (const [key, value] of Object.entries(aggregate)) {
        if (key === 'checked_at') {
          continue;
        }
        aggregate[key] += Number(summary[key] || 0);
      }
    } catch (error) {
      console.warn(`Reply sync skipped for ${tenant.slug}`, error instanceof Error ? error.message : String(error || 'Unknown error'));
    }
  }

  if (options.tenantId) {
    const tenantMatch = allTenants.find((tenant) => String(tenant.id) === String(options.tenantId));
    return tenantMatch ? tenantSummaries[tenantMatch.slug] || null : null;
  }

  return {
    ...aggregate,
    tenants: tenantSummaries,
  };
}
