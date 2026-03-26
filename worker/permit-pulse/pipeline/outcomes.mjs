import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';
import { cancelFollowUps } from './follow-up.mjs';

async function upsertDomainReputation(db, domain, patch) {
  const existing = await db.single('v2_domain_reputation', {
    filters: [eq('domain', domain)],
  });

  const next = {
    domain,
    total_sent: Number(existing?.total_sent || 0),
    total_delivered: Number(existing?.total_delivered || 0),
    total_bounced: Number(existing?.total_bounced || 0),
    total_replied: Number(existing?.total_replied || 0),
    reputation_score: Number(existing?.reputation_score || 50),
    ...patch,
    updated_at: new Date().toISOString(),
  };

  next.delivery_rate = next.total_sent > 0 ? next.total_delivered / next.total_sent : 0;
  const [row] = await db.upsert('v2_domain_reputation', next, 'domain');
  return row || next;
}

async function recordEmailOutcome(db, leadId, email, outcome, bounceType = null, bounceReason = null) {
  if (!email) {
    return null;
  }

  const [row] = await db.insert('v2_email_outcomes', {
    lead_id: leadId,
    email_address: email,
    domain: email.split('@')[1],
    local_part: email.split('@')[0],
    outcome,
    bounce_type: bounceType,
    bounce_reason: bounceReason,
    sent_at: new Date().toISOString(),
  });

  return row || null;
}

export async function markLeadOutcome(db, leadId, payload, actorId = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    throw new Error('Lead not found');
  }

  const activeEmail = lead.active_email_role === 'fallback' && lead.fallback_email ? lead.fallback_email : lead.contact_email;
  const domain = activeEmail?.split('@')[1] || '';
  const outcome = payload.outcome;

  if (['bounced', 'replied', 'delivered'].includes(outcome) && activeEmail) {
    await recordEmailOutcome(db, leadId, activeEmail, outcome, payload.bounce_type || null, payload.bounce_reason || null);
  }

  if (outcome === 'delivered' && domain) {
    await upsertDomainReputation(db, domain, {
      total_sent: Number(payload.total_sent || 1),
      total_delivered: Number((await db.single('v2_domain_reputation', { filters: [eq('domain', domain)] }))?.total_delivered || 0) + 1,
      reputation_score: Number((await db.single('v2_domain_reputation', { filters: [eq('domain', domain)] }))?.reputation_score || 50) + 2,
      last_success_at: new Date().toISOString(),
    });
  }

  if (outcome === 'replied' && domain) {
    const existing = await db.single('v2_domain_reputation', { filters: [eq('domain', domain)] });
    await upsertDomainReputation(db, domain, {
      total_sent: Number(existing?.total_sent || 0),
      total_replied: Number(existing?.total_replied || 0) + 1,
      reputation_score: Number(existing?.reputation_score || 50) + 5,
      last_success_at: new Date().toISOString(),
    });
    await cancelFollowUps(db, leadId, 'replied');
    await db.update('v2_leads', [`id=eq.${leadId}`], { status: 'archived' });
  }

  if (outcome === 'bounced' && domain) {
    const existing = await db.single('v2_domain_reputation', { filters: [eq('domain', domain)] });
    await upsertDomainReputation(db, domain, {
      total_sent: Number(existing?.total_sent || 0),
      total_bounced: Number(existing?.total_bounced || 0) + 1,
      reputation_score: Number(existing?.reputation_score || 50) - (payload.bounce_type === 'soft' ? 5 : 15),
      last_bounce_at: new Date().toISOString(),
    });
    await cancelFollowUps(db, leadId, 'bounced');

    if (lead.active_email_role === 'primary' && lead.fallback_email) {
      await db.update('v2_leads', [`id=eq.${leadId}`], {
        active_email_role: 'fallback',
        status: 'ready',
        updated_at: new Date().toISOString(),
      });
      await appendLeadEvent(db, {
        lead_id: leadId,
        event_type: 'fallback_activated',
        actor_type: actorId ? 'operator' : 'system',
        actor_id: actorId,
        detail: {
          next_email: lead.fallback_email,
        },
      });
    } else {
      await db.update('v2_leads', [`id=eq.${leadId}`], {
        status: 'archived',
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (outcome === 'won' || outcome === 'lost') {
    await cancelFollowUps(db, leadId, outcome);
    await db.update('v2_leads', [`id=eq.${leadId}`], {
      status: 'archived',
      operator_notes: payload.notes || lead.operator_notes || '',
    });
  }

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: outcome,
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: payload,
  });

  return {
    success: true,
    outcome,
  };
}

export async function switchLeadToFallback(db, leadId, actorId = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead?.fallback_email) {
    throw new Error('No fallback email available');
  }

  await db.update('v2_leads', [`id=eq.${leadId}`], {
    active_email_role: 'fallback',
    status: 'ready',
    updated_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: 'fallback_activated',
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: { next_email: lead.fallback_email },
  });

  return {
    success: true,
    active_email_role: 'fallback',
  };
}

export async function vouchLeadEmail(db, leadId, actorId = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead?.contact_email) {
    throw new Error('No contact email available');
  }

  const domain = lead.contact_email.split('@')[1];
  const existing = await db.single('v2_domain_reputation', { filters: [eq('domain', domain)] });
  await upsertDomainReputation(db, domain, {
    total_sent: Number(existing?.total_sent || 0),
    reputation_score: Number(existing?.reputation_score || 50) + 10,
    last_success_at: new Date().toISOString(),
  });

  await db.update('v2_leads', [`id=eq.${leadId}`], {
    operator_vouched: true,
    updated_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    event_type: 'operator_vouched',
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: {
      email: lead.contact_email,
    },
  });

  return {
    success: true,
  };
}
