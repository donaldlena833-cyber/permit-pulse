import { sendAutomationEmail } from '../lib/gmail.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { eq, inList, order } from '../lib/supabase.mjs';
import { inferEmailPattern, nowIso } from '../lib/utils.mjs';
import { scheduleFollowUps } from './follow-up.mjs';
import { generateLeadDraft } from './draft.mjs';

const MAX_EMAILS_PER_DAY = 80;
const MIN_SEND_DELAY_MS = 8000;
const MAX_SEND_DELAY_MS = 20000;
const DEFAULT_EMAIL_ONLY_FOLLOW_UP_SEQUENCE = ['email:0', 'email:4', 'email:8', 'email:14'];

function tierRank(tier) {
  if (tier === 'hot') return 0;
  if (tier === 'warm') return 1;
  return 2;
}

function randomSendDelayMs() {
  return MIN_SEND_DELAY_MS + Math.floor(Math.random() * (MAX_SEND_DELAY_MS - MIN_SEND_DELAY_MS));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startOfDayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

async function countSentToday(db) {
  const rows = await db.select('v2_email_outcomes', {
    columns: 'id',
    filters: [eq('outcome', 'sent'), `sent_at=gte.${encodeURIComponent(startOfDayIso())}`],
  });
  return rows.length;
}

async function getActiveCandidate(db, lead) {
  const email = lead.active_email_role === 'fallback' && lead.fallback_email ? lead.fallback_email : lead.contact_email;
  if (!email) {
    return null;
  }

  return db.single('v2_email_candidates', {
    filters: [eq('lead_id', lead.id), eq('email_address', email), eq('is_current', true)],
  });
}

export async function sendLead(env, db, leadId, options = {}) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    throw new Error('Lead not found');
  }

  const candidate = await getActiveCandidate(db, lead);
  const recipient = candidate?.email_address || '';

  if (!recipient) {
    throw new Error('No email available');
  }

  if (!options.force && !candidate?.is_auto_sendable && !candidate?.is_manual_sendable) {
    throw new Error('No send approved email route');
  }

  if (!lead.draft_subject || !lead.draft_body) {
    await generateLeadDraft(db, options.runId || null, leadId);
  }

  const refreshedLead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });

  await sendAutomationEmail(env, {
    recipient,
    subject: refreshedLead.draft_subject,
    body: refreshedLead.draft_body,
  });

  await db.insert('v2_email_outcomes', {
    lead_id: leadId,
    run_id: options.runId || null,
    email_address: recipient,
    domain: recipient.split('@')[1],
    local_part: recipient.split('@')[0],
    email_pattern: inferEmailPattern(recipient, refreshedLead.contact_name || ''),
    outcome: 'sent',
    sent_at: nowIso(),
  });

  await db.update('v2_leads', [`id=eq.${leadId}`], {
    status: 'sent',
    sent_at: nowIso(),
    updated_at: nowIso(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: options.runId || null,
    event_type: options.stepNumber ? 'follow_up_sent' : 'sent',
    actor_type: options.actorId ? 'operator' : 'system',
    actor_id: options.actorId || null,
    detail: {
      recipient,
      step_number: options.stepNumber || null,
    },
  });

  if (!options.stepNumber) {
    await scheduleFollowUps(
      db,
      leadId,
      options.followUpSequence || DEFAULT_EMAIL_ONLY_FOLLOW_UP_SEQUENCE,
      nowIso(),
    );
  }

  return {
    success: true,
    recipient,
    sentAt: nowIso(),
  };
}

export async function sendReadyLeads(env, db, runId, config, options = {}) {
  const sentToday = await countSentToday(db);
  const scopedLeadIds = [...new Set(
    (Array.isArray(options.leadIds) ? options.leadIds : [])
      .map((leadId) => String(leadId || '').trim())
      .filter(Boolean),
  )];
  const configuredCap = config.warm_up_mode
    ? Number(config.warm_up_daily_cap || MAX_EMAILS_PER_DAY)
    : Number(config.daily_send_cap || MAX_EMAILS_PER_DAY);
  const cap = Math.min(configuredCap, MAX_EMAILS_PER_DAY);
  const remaining = Math.max(cap - sentToday, 0);

  if (remaining <= 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      remaining: 0,
    };
  }

  if (options.leadIds && scopedLeadIds.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      remaining,
    };
  }

  const filters = [eq('status', 'ready')];
  if (scopedLeadIds.length > 0) {
    filters.push(inList('id', scopedLeadIds));
  }

  const leads = await db.select('v2_leads', {
    filters,
    ordering: [order('updated_at', 'desc')],
    limit: Math.max(remaining * 4, 20),
  });

  const prioritizedLeads = [...leads]
    .sort((left, right) => {
      const tierDelta = tierRank(left.quality_tier) - tierRank(right.quality_tier);
      if (tierDelta !== 0) {
        return tierDelta;
      }
      return Number(right.relevance_score || 0) - Number(left.relevance_score || 0);
    })
    .slice(0, remaining);

  let succeeded = 0;
  let failed = 0;

  for (const [index, lead] of prioritizedLeads.entries()) {
    try {
      await sendLead(env, db, lead.id, {
        runId,
        followUpSequence: config.follow_up_sequence,
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await db.update('v2_leads', [`id=eq.${lead.id}`], {
        status: 'review',
        updated_at: nowIso(),
      });
      await appendLeadEvent(db, {
        lead_id: lead.id,
        run_id: runId || null,
        event_type: 'send_failed',
        detail: {
          error: error instanceof Error ? error.message : String(error || 'Send failed'),
        },
      });
    }

    if (index < prioritizedLeads.length - 1) {
      await sleep(randomSendDelayMs());
    }
  }

  return {
    attempted: prioritizedLeads.length,
    succeeded,
    failed,
    remaining: Math.max(remaining - succeeded, 0),
  };
}
