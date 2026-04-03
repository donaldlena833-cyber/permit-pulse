import { listRecentInboxReplies } from '../gmail.mjs';
import { appendLeadEvent } from './events.mjs';
import { markLeadOutcome } from '../pipeline/outcomes.mjs';
import { markProspectReply, optOutProspect } from './prospects.mjs';
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

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function bodyForClassification(message) {
  return compactText([message.subject, message.snippet].filter(Boolean).join(' '));
}

function classifyInboundReply(message) {
  const text = bodyForClassification(message);
  if (!text) {
    return 'reply';
  }
  if (OPT_OUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'opt_out';
  }
  if (POSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'positive';
  }
  return 'reply';
}

function normalizeEmail(value) {
  const email = compactText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function kvAvailable(env) {
  return Boolean(env?.PERMIT_PULSE?.get && env?.PERMIT_PULSE?.put);
}

async function hasSeenMessage(env, messageId) {
  if (!kvAvailable(env) || !messageId) {
    return false;
  }
  return Boolean(await env.PERMIT_PULSE.get(`${SEEN_PREFIX}${messageId}`));
}

async function markMessageSeen(env, messageId) {
  if (!kvAvailable(env) || !messageId) {
    return;
  }
  await env.PERMIT_PULSE.put(`${SEEN_PREFIX}${messageId}`, '1', { expirationTtl: 60 * 60 * 24 * 60 });
}

async function writeSummary(env, summary) {
  if (!kvAvailable(env)) {
    return summary;
  }
  await env.PERMIT_PULSE.put(SUMMARY_KEY, JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 60 });
  return summary;
}

export async function readReplySyncState(env) {
  if (!kvAvailable(env)) {
    return null;
  }
  const value = await env.PERMIT_PULSE.get(SUMMARY_KEY);
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
    limit: 2000,
  }).catch(() => []);
}

async function listCandidateLeads(db) {
  const since = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000)).toISOString();
  return db.select('v2_leads', {
    columns: 'id,status,company_name,address,contact_email,fallback_email,updated_at,sent_at',
    filters: [eq('status', 'sent'), gte('sent_at', since)],
    ordering: [order('sent_at', 'desc')],
    limit: 2000,
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

async function applyProspectReply(db, prospect, classification, message) {
  const detail = {
    source: 'gmail_reply_sync',
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    sender_email: message.fromEmail,
    subject: message.subject || null,
    snippet: message.snippet || null,
    received_at: message.internalDate || null,
  };

  if (classification === 'opt_out') {
    await optOutProspect(db, prospect.id, null, 'system', detail);
    return 'opt_out';
  }

  await markProspectReply(db, prospect.id, null, classification === 'positive' ? 'positive' : 'neutral', 'system', detail);
  return classification === 'positive' ? 'positive' : 'reply';
}

async function applyLeadReply(db, lead, classification, message) {
  const detail = {
    source: 'gmail_reply_sync',
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    sender_email: message.fromEmail,
    subject: message.subject || null,
    snippet: message.snippet || null,
    received_at: message.internalDate || null,
  };

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

export async function syncOutreachReplies(env, db, options = {}) {
  const maxResults = Math.min(Math.max(Number(options.maxResults || 0), 1), 100);
  const newerThanDays = Math.min(Math.max(Number(options.newerThanDays || 0), 1), 45);
  const [messages, prospects, leads] = await Promise.all([
    listRecentInboxReplies(env, { maxResults, newerThanDays }),
    listCandidateProspects(db),
    listCandidateLeads(db),
  ]);

  const prospectMaps = buildProspectEmailMap(prospects);
  const leadEmailMap = buildLeadEmailMap(leads);

  const summary = {
    checked_at: new Date().toISOString(),
    scanned_messages: messages.length,
    processed_messages: 0,
    prospect_replies: 0,
    lead_replies: 0,
    opt_outs: 0,
    positive_replies: 0,
    unmatched_messages: 0,
  };

  for (const message of messages) {
    if (!message?.id || !message.fromEmail) {
      continue;
    }
    if (await hasSeenMessage(env, message.id)) {
      continue;
    }

    const classification = classifyInboundReply(message);
    const prospect = prospectMaps.byThreadId.get(String(message.threadId || ''))
      || prospectMaps.byEmail.get(message.fromEmail);
    const lead = leadEmailMap.get(message.fromEmail);

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
      await markMessageSeen(env, message.id);
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
      await markMessageSeen(env, message.id);
      continue;
    }

    summary.unmatched_messages += 1;
    await markMessageSeen(env, message.id);
  }

  await writeSummary(env, summary);
  return summary;
}
