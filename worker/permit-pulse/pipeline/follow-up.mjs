import { sendAutomationEmail } from '../lib/gmail.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { formatPriorOutreachMessage, getPriorOutreach } from '../lib/outreach-guard.mjs';
import { eq, gte, lte, order } from '../lib/supabase.mjs';
import { buildFollowUpDraft } from './draft.mjs';

function normalizeFollowUpSequence(sequence) {
  const fallback = ['email:3', 'email:14'];
  if (!Array.isArray(sequence)) {
    return fallback;
  }

  const normalized = sequence
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => {
      const [channel, dayString] = entry.split(':');
      const days = Math.max(0, Number(dayString || 0));
      return channel === 'email' && days > 0 ? { channel, days } : null;
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback.map((entry) => {
    const [channel, dayString] = entry.split(':');
    return { channel, days: Number(dayString || 0) };
  });
}

function isLegacyPlaceholderFollowUp(item) {
  return Number(item?.step_number || 0) === 1
    && String(item?.status || '') === 'sent'
    && String(item?.outcome_notes || '').includes('Repeat outreach disabled');
}

function followUpNeedsRepair(existing, sequence) {
  const legacyPlaceholder = existing.find(isLegacyPlaceholderFollowUp);
  if (legacyPlaceholder) {
    return true;
  }

  const expectedSteps = normalizeFollowUpSequence(sequence);
  const existingSteps = new Set(existing.map((item) => Number(item.step_number || 0)));
  return expectedSteps.some((_, index) => !existingSteps.has(index + 1));
}

export async function scheduleFollowUps(db, leadId, sequence, sentAt) {
  const baseDate = new Date(sentAt || Date.now());
  const existing = await db.select('v2_follow_ups', {
    filters: [eq('lead_id', leadId)],
  });
  const legacyPlaceholder = existing.find(isLegacyPlaceholderFollowUp);
  const existingSteps = new Set(
    existing
      .filter((item) => !(legacyPlaceholder && String(item.id) === String(legacyPlaceholder.id)))
      .map((item) => Number(item.step_number || 0)),
  );
  const rows = [];
  const normalizedSequence = normalizeFollowUpSequence(sequence);

  for (const [index, item] of normalizedSequence.entries()) {
    const stepNumber = index + 1;
    if (legacyPlaceholder && stepNumber === 1) {
      const scheduledAt = new Date(baseDate);
      scheduledAt.setDate(scheduledAt.getDate() + Number(item.days || 0));
      await db.update('v2_follow_ups', [`id=eq.${legacyPlaceholder.id}`], {
        channel: item.channel,
        status: 'pending',
        scheduled_at: scheduledAt.toISOString(),
        sent_at: null,
        outcome_notes: null,
        cancelled_reason: null,
        draft_content: null,
      });
      existingSteps.add(stepNumber);
      continue;
    }

    if (existingSteps.has(stepNumber)) {
      continue;
    }

    const scheduledAt = new Date(baseDate);
    scheduledAt.setDate(scheduledAt.getDate() + Number(item.days || 0));

    rows.push({
      lead_id: leadId,
      step_number: stepNumber,
      channel: item.channel,
      status: 'pending',
      scheduled_at: scheduledAt.toISOString(),
      created_at: baseDate.toISOString(),
    });
  }

  if (rows.length === 0) {
    return existing;
  }

  const inserted = await db.insert('v2_follow_ups', rows);
  return [...existing, ...inserted];
}

export async function cancelFollowUps(db, leadId, reason) {
  await db.update('v2_follow_ups', [eq('lead_id', leadId), eq('status', 'pending')], {
    status: 'cancelled',
    cancelled_reason: reason,
  });
}

export async function sendFollowUp(env, db, leadId, stepNumber, actorId = null) {
  const followUp = await db.single('v2_follow_ups', {
    filters: [eq('lead_id', leadId), eq('step_number', stepNumber)],
  });
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });

  if (!followUp || !lead) {
    throw new Error('Follow up not found');
  }

  if (followUp.channel === 'phone') {
    throw new Error('Phone follow up must be logged manually');
  }

  const draft = followUp.draft_content
    ? { subject: lead.draft_subject || `Follow up for ${lead.address}`, body: followUp.draft_content }
    : buildFollowUpDraft(lead, stepNumber);

  const recipient = lead.active_email_role === 'fallback' && lead.fallback_email ? lead.fallback_email : lead.contact_email;
  if (!recipient) {
    throw new Error('No email available');
  }

  const priorOutreach = await getPriorOutreach(db, recipient);
  if (priorOutreach) {
    const sameLead = priorOutreach.lead_id && String(priorOutreach.lead_id) === String(lead.id);
    if (!sameLead) {
      await db.update('v2_follow_ups', [`id=eq.${followUp.id}`], {
        status: 'skipped',
        cancelled_reason: 'repeat_contact_disabled',
        outcome_notes: formatPriorOutreachMessage(priorOutreach),
      });

      await appendLeadEvent(db, {
        lead_id: leadId,
        event_type: 'follow_up_suppressed',
        actor_type: actorId ? 'operator' : 'system',
        actor_id: actorId,
        detail: {
          step_number: stepNumber,
          recipient,
          reason: 'repeat_contact_disabled',
        },
      });

      throw new Error('Repeat outreach is disabled for this recipient');
    }
  }

  await sendAutomationEmail(env, {
    recipient,
    subject: draft.subject,
    body: draft.body,
  });

  await db.update('v2_follow_ups', [`id=eq.${followUp.id}`], {
    status: 'sent',
    sent_at: new Date().toISOString(),
    draft_content: draft.body,
  });

  await db.insert('v2_email_outcomes', {
    lead_id: leadId,
    email_address: recipient,
    domain: recipient.split('@')[1],
    local_part: recipient.split('@')[0],
    outcome: 'sent',
    sent_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: 'follow_up_sent',
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: {
      step_number: stepNumber,
      channel: 'email',
      recipient,
    },
  });

  return {
    success: true,
    step_number: stepNumber,
    recipient,
  };
}

export async function skipFollowUp(db, leadId, stepNumber, actorId = null) {
  const followUp = await db.single('v2_follow_ups', {
    filters: [eq('lead_id', leadId), eq('step_number', stepNumber)],
  });
  if (!followUp) {
    throw new Error('Follow up not found');
  }

  await db.update('v2_follow_ups', [`id=eq.${followUp.id}`], {
    status: 'skipped',
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: 'follow_up_skipped',
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: {
      step_number: stepNumber,
    },
  });
}

export async function logPhoneFollowUp(db, leadId, stepNumber, notes, actorId = null) {
  const followUp = await db.single('v2_follow_ups', {
    filters: [eq('lead_id', leadId), eq('step_number', stepNumber)],
  });
  if (!followUp) {
    throw new Error('Follow up not found');
  }

  await db.update('v2_follow_ups', [`id=eq.${followUp.id}`], {
    outcome_notes: notes || '',
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: 'follow_up_logged',
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: {
      step_number: stepNumber,
      notes: notes || '',
    },
  });
}

export async function processDueFollowUps(env, db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 0), 1), 50);
  const due = await db.select('v2_follow_ups', {
    filters: [eq('status', 'pending'), lte('scheduled_at', new Date().toISOString())],
    ordering: [order('scheduled_at', 'asc')],
    limit,
  });

  let sent = 0;
  for (const item of due) {
    if (item.channel !== 'email') {
      continue;
    }
    try {
      await sendFollowUp(env, db, item.lead_id, item.step_number);
      sent += 1;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Repeat outreach is disabled')) {
        throw error;
      }
    }
  }

  return { sent };
}

export async function backfillPermitFollowUps(db, config, options = {}) {
  const limit = Math.max(1, Number(options.limit || 250));
  const lookbackDays = Math.max(7, Number(options.lookbackDays || 30));
  const since = new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000)).toISOString();

  const leads = await db.select('v2_leads', {
    columns: 'id,status,sent_at',
    filters: [eq('status', 'sent'), gte('sent_at', since)],
    ordering: [order('sent_at', 'desc')],
    limit,
  }).catch(() => []);

  let repairedLeads = 0;
  let repairedRows = 0;

  for (const lead of leads) {
    const existing = await db.select('v2_follow_ups', {
      filters: [eq('lead_id', lead.id)],
      ordering: [order('step_number', 'asc')],
    }).catch(() => []);

    if (!followUpNeedsRepair(existing, config.follow_up_sequence)) {
      continue;
    }

    const beforePendingCount = existing.filter((item) => String(item.status || '') === 'pending').length;
    const beforeCount = existing.length;
    const next = await scheduleFollowUps(db, lead.id, config.follow_up_sequence, lead.sent_at || new Date().toISOString());
    const afterPendingCount = next.filter((item) => String(item.status || '') === 'pending').length;
    const afterCount = next.length;

    repairedLeads += 1;
    repairedRows += Math.max(afterPendingCount - beforePendingCount, 0) + Math.max(afterCount - beforeCount, 0);
  }

  return {
    scanned: leads.length,
    repaired_leads: repairedLeads,
    repaired_rows: repairedRows,
  };
}
