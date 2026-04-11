import { isApprovedRouteCandidate, isAutoSendRouteCandidate } from '../lib/email-approval.mjs';
import { sendAutomationEmail } from '../lib/gmail.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { formatPriorOutreachMessage, getPriorOutreach } from '../lib/outreach-guard.mjs';
import { eq, inList, order } from '../lib/supabase.mjs';
import { inferEmailPattern, nowIso } from '../lib/utils.mjs';
import { scheduleFollowUps } from './follow-up.mjs';
import { generateLeadDraft } from './draft.mjs';

function tierRank(tier) {
  if (tier === 'hot') return 0;
  if (tier === 'warm') return 1;
  return 2;
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

async function suppressDuplicateLeadRecipient(db, lead, recipient, prior, options = {}) {
  const timestamp = nowIso();

  await db.update('v2_leads', [`id=eq.${lead.id}`], {
    status: 'archived',
    updated_at: timestamp,
  });

  await appendLeadEvent(db, {
    lead_id: lead.id,
    run_id: options.runId || null,
    event_type: 'duplicate_recipient_suppressed',
    actor_type: options.actorId ? 'operator' : 'system',
    actor_id: options.actorId || null,
    detail: {
      recipient,
      prior_outcome: prior?.outcome || null,
      prior_sent_at: prior?.sent_at || prior?.created_at || null,
      source_table: prior?.source_table || null,
    },
  });
}

export async function sendLead(env, db, tenant, leadId, options = {}) {
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

  const normalizedRecipient = String(recipient).trim().toLowerCase();
  const priorOutreach = await getPriorOutreach(db, normalizedRecipient);
  if (priorOutreach) {
    const sameLead = priorOutreach.lead_id && String(priorOutreach.lead_id) === String(lead.id);
    if (!sameLead && lead.status !== 'sent') {
      await suppressDuplicateLeadRecipient(db, lead, normalizedRecipient, priorOutreach, options);
      throw new Error(`${formatPriorOutreachMessage(priorOutreach)}. Lead archived to prevent duplicate outreach.`);
    }
    throw new Error(`${formatPriorOutreachMessage(priorOutreach)}. Repeat outreach is disabled.`);
  }

  if (!options.force) {
    const isAllowed = options.requireAutoApproved
      ? isAutoSendRouteCandidate(candidate, lead)
      : isApprovedRouteCandidate(candidate, lead);
    if (!isAllowed) {
      throw new Error(options.requireAutoApproved ? 'No auto send approved email route' : 'No send approved email route');
    }
  }

  if (!lead.draft_subject || !lead.draft_body) {
    await generateLeadDraft(db, tenant, options.runId || null, leadId);
  }

  const refreshedLead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });

  await sendAutomationEmail(env, db, tenant, {
    recipient: normalizedRecipient,
    subject: refreshedLead.draft_subject,
    body: refreshedLead.draft_body,
  });

  await db.insert('v2_email_outcomes', {
    lead_id: leadId,
    run_id: options.runId || null,
    email_address: normalizedRecipient,
    domain: normalizedRecipient.split('@')[1],
    local_part: normalizedRecipient.split('@')[0],
    email_pattern: inferEmailPattern(normalizedRecipient, refreshedLead.contact_name || ''),
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
      normalized_recipient: normalizedRecipient,
      step_number: options.stepNumber || null,
    },
  });
  await scheduleFollowUps(db, leadId, options.followUpSequence || ['email:3', 'email:14'], nowIso());

  return {
    success: true,
    recipient: normalizedRecipient,
    sentAt: nowIso(),
  };
}

export async function sendReadyLeads(env, db, runId, config, options = {}) {
  const sentToday = await countSentToday(db);
  const cap = config.warm_up_mode ? Number(config.warm_up_daily_cap || 5) : Number(config.daily_send_cap || 20);
  const remaining = Math.max(cap - sentToday, 0);

  if (remaining <= 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      remaining: 0,
    };
  }

  const leads = await db.select('v2_leads', {
    filters: [
      eq('status', 'ready'),
      ...(Array.isArray(options.leadIds) && options.leadIds.length > 0 ? [inList('id', options.leadIds)] : []),
    ],
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

  for (const lead of prioritizedLeads) {
    try {
      await sendLead(env, db, options.tenant || null, lead.id, {
        runId,
        requireAutoApproved: true,
        followUpSequence: config.follow_up_sequence,
      });
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: prioritizedLeads.length,
    succeeded,
    failed,
    remaining: Math.max(remaining - succeeded, 0),
  };
}
