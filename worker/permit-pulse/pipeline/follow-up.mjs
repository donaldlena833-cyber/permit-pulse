import { sendAutomationEmail } from '../lib/gmail.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { formatPriorOutreachMessage, getPriorOutreach } from '../lib/outreach-guard.mjs';
import { eq, lte, order } from '../lib/supabase.mjs';
import { buildFollowUpDraft } from './draft.mjs';

export async function scheduleFollowUps(db, leadId, sequence, sentAt) {
  const baseDate = new Date(sentAt || Date.now());
  const existing = await db.select('v2_follow_ups', {
    filters: [eq('lead_id', leadId)],
  });
  if (existing.length > 0) {
    return existing;
  }

  const firstEntry = Array.isArray(sequence) && sequence.length > 0 ? String(sequence[0]) : 'email:0';
  const [channel, dayString] = firstEntry.split(':');
  const days = Number(dayString || 0);
  const scheduledAt = new Date(baseDate);
  scheduledAt.setDate(scheduledAt.getDate() + days);

  const rows = [{
    lead_id: leadId,
    step_number: 1,
    channel,
    status: 'sent',
    scheduled_at: scheduledAt.toISOString(),
    sent_at: baseDate.toISOString(),
    outcome_notes: 'Repeat outreach disabled: initial email only',
  }];

  return db.insert('v2_follow_ups', rows);
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

export async function processDueFollowUps(env, db) {
  const due = await db.select('v2_follow_ups', {
    filters: [eq('status', 'pending'), lte('scheduled_at', new Date().toISOString())],
    ordering: [order('scheduled_at', 'asc')],
    limit: 20,
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
