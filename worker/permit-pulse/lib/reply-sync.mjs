import { listRecentInboxMessages } from '../gmail.mjs';
import { appendLeadEvent } from './events.mjs';
import { markLeadOutcome } from '../pipeline/outcomes.mjs';
import {
  markProspectBounced,
  markProspectReply,
  optOutProspect,
  queueOutreachReviewItem,
} from './prospects.mjs';
import { eq, gte, order } from './supabase.mjs';

const SUMMARY_KEY = 'reply_sync:last_summary';
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

function scopeKeySuffix(scopeKey) {
  const normalized = compactText(scopeKey).replace(/[^a-zA-Z0-9:_-]/g, '_');
  return normalized || 'global';
}

function summaryKey(scopeKey) {
  return `${SUMMARY_KEY}:${scopeKeySuffix(scopeKey)}`;
}

function seenKey(messageId, scopeKey) {
  return `${SEEN_PREFIX}${scopeKeySuffix(scopeKey)}:${messageId}`;
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

async function hasSeenMessage(env, messageId, scopeKey = 'global') {
  if (!kvAvailable(env) || !messageId) {
    return false;
  }
  return Boolean(await env.PERMIT_PULSE.get(seenKey(messageId, scopeKey)));
}

async function markMessageSeen(env, messageId, scopeKey = 'global') {
  if (!kvAvailable(env) || !messageId) {
    return;
  }
  await env.PERMIT_PULSE.put(seenKey(messageId, scopeKey), '1', { expirationTtl: 60 * 60 * 24 * 60 });
}

async function writeSummary(env, summary, scopeKey = 'global') {
  if (!kvAvailable(env)) {
    return summary;
  }
  await env.PERMIT_PULSE.put(summaryKey(scopeKey), JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 60 });
  return summary;
}

export async function readReplySyncState(env, options = {}) {
  if (!kvAvailable(env)) {
    return null;
  }
  const value = await env.PERMIT_PULSE.get(summaryKey(options.scopeKey || 'global'));
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

export async function syncOutreachReplies(env, db, options = {}) {
  const maxResults = Math.min(Math.max(Number(options.maxResults || 0), 1), 100);
  const newerThanDays = Math.min(Math.max(Number(options.newerThanDays || 0), 1), 45);
  const scopeKey = options.scopeKey || db?.tenant_id || 'global';
  const queueUnmatched = options.queueUnmatched !== false;
  const [messages, prospects, leads] = await Promise.all([
    listRecentInboxMessages(env, { maxResults, newerThanDays, includeBody: true, mailbox: options.mailbox || null }),
    listCandidateProspects(db),
    listCandidateLeads(db),
  ]);

  const prospectMaps = buildProspectEmailMap(prospects);
  const leadEmailMap = buildLeadEmailMap(leads);
  const knownEmails = allKnownEmails(prospects, leads);

  const summary = {
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
    if (await hasSeenMessage(env, message.id, scopeKey)) {
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
      if (!queueUnmatched && !prospect) {
        summary.unmatched_messages += 1;
        continue;
      }
      await queueReview(db, message, prospect, 'auto_reply_review');
      summary.processed_messages += 1;
      summary.review_items += 1;
      await markMessageSeen(env, message.id, scopeKey);
      continue;
    }

    if (prospect) {
      const applied = await applyProspectReply(db, prospect, classification, message);
      summary.processed_messages += 1;
      summary.prospect_replies += 1;
      if (applied === 'opt_out') {
        summary.opt_outs += 1;
      }
      if (applied === 'positive') {
        summary.positive_replies += 1;
      }
      if (applied === 'bounce') {
        summary.bounces += 1;
      }
      await markMessageSeen(env, message.id, scopeKey);
      continue;
    }

    if (lead) {
      const applied = await applyLeadReply(db, lead, classification, message);
      summary.processed_messages += 1;
      summary.lead_replies += 1;
      if (applied === 'opt_out') {
        summary.opt_outs += 1;
      }
      if (applied === 'positive') {
        summary.positive_replies += 1;
      }
      if (applied === 'bounce') {
        summary.bounces += 1;
      }
      await markMessageSeen(env, message.id, scopeKey);
      continue;
    }

    if (!queueUnmatched) {
      summary.unmatched_messages += 1;
      continue;
    }

    if (classification === 'bounce' || classification === 'reply' || classification === 'positive' || classification === 'opt_out') {
      await queueReview(db, message, null, classification === 'bounce' ? 'bounce_review_pending' : 'unmatched_reply_review');
      summary.review_items += 1;
      summary.processed_messages += 1;
    } else {
      summary.unmatched_messages += 1;
    }

    await markMessageSeen(env, message.id, scopeKey);
  }

  await writeSummary(env, summary, scopeKey);
  return summary;
}
