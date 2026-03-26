import { appendLeadEvent } from '../lib/events.mjs';
import { isBlockedEmail, normalizeEmail } from '../lib/email.mjs';
import { eq } from '../lib/supabase.mjs';
import { getDomainFromEmail, getLocalPart, looksLikeEmail, nowIso, uniq } from '../lib/utils.mjs';
import { cancelFollowUps } from './follow-up.mjs';

function sortEmailCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const trustDelta = Number(right?.trust_score || 0) - Number(left?.trust_score || 0);
    if (trustDelta !== 0) {
      return trustDelta;
    }

    return Number(new Date(right?.discovered_at || 0).getTime()) - Number(new Date(left?.discovered_at || 0).getTime());
  });
}

function buildOperatorReasons(existingReasons = [], reason) {
  return uniq([reason, ...(Array.isArray(existingReasons) ? existingReasons : [])]);
}

async function applyOperatorRoute(db, lead, primaryCandidate, actorId = null, eventType = 'operator_email_selected', detail = {}) {
  const candidates = await db.select('v2_email_candidates', {
    filters: [eq('lead_id', lead.id), eq('is_current', true)],
  });
  const fallbackCandidate = sortEmailCandidates(
    candidates.filter((candidate) => candidate.id !== primaryCandidate.id),
  )[0] || null;

  for (const candidate of candidates) {
    const isPrimary = candidate.id === primaryCandidate.id;
    const isFallback = Boolean(fallbackCandidate) && candidate.id === fallbackCandidate.id;
    await db.update('v2_email_candidates', [`id=eq.${candidate.id}`], {
      is_primary: isPrimary,
      is_fallback: isFallback,
      selection_reason: isPrimary
        ? 'Operator selected send route'
        : isFallback
          ? 'Operator kept as alternate route'
          : null,
      rejected_reason: isPrimary || isFallback ? null : 'Operator chose a different route',
    });
  }

  await db.update('v2_leads', [`id=eq.${lead.id}`], {
    contact_name: primaryCandidate.person_name || lead.contact_name || lead.applicant_name || lead.owner_name || '',
    contact_role: primaryCandidate.person_role || lead.contact_role || (lead.applicant_name ? 'gc_applicant' : lead.owner_name ? 'owner' : 'unknown'),
    contact_email: primaryCandidate.email_address,
    contact_email_trust: Number(primaryCandidate.trust_score || 0),
    fallback_email: fallbackCandidate?.email_address || '',
    fallback_email_trust: Number(fallbackCandidate?.trust_score || 0),
    active_email_role: 'primary',
    operator_vouched: true,
    status: 'ready',
    updated_at: nowIso(),
  });

  await appendLeadEvent(db, {
    lead_id: lead.id,
    event_type: eventType,
    actor_type: actorId ? 'operator' : 'system',
    actor_id: actorId,
    detail: {
      email: primaryCandidate.email_address,
      fallback_email: fallbackCandidate?.email_address || null,
      candidate_id: primaryCandidate.id,
      ...detail,
    },
  });

  return {
    success: true,
    email: primaryCandidate.email_address,
    fallback_email: fallbackCandidate?.email_address || null,
    status: 'ready',
  };
}

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

export async function chooseLeadEmailCandidate(db, leadId, candidateId, actorId = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    throw new Error('Lead not found');
  }

  const candidate = await db.single('v2_email_candidates', {
    filters: [eq('lead_id', leadId), eq('id', candidateId), eq('is_current', true)],
  });
  if (!candidate?.email_address) {
    throw new Error('Email candidate not found');
  }

  const patchedCandidate = {
    ...candidate,
    trust_score: Math.max(Number(candidate.trust_score || 0), 45),
    trust_reasons: buildOperatorReasons(candidate.trust_reasons, '+45 operator approved route'),
    is_manual_sendable: true,
    is_research_only: false,
  };

  const [updatedCandidate] = await db.update('v2_email_candidates', [`id=eq.${candidate.id}`], {
    trust_score: patchedCandidate.trust_score,
    trust_reasons: patchedCandidate.trust_reasons,
    is_manual_sendable: true,
    is_research_only: false,
    rejected_reason: null,
  });

  return applyOperatorRoute(
    db,
    lead,
    updatedCandidate || patchedCandidate,
    actorId,
    'operator_email_selected',
    { selected_source: candidate.provenance_source || 'unknown' },
  );
}

export async function addManualLeadEmail(db, leadId, payload = {}, actorId = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    throw new Error('Lead not found');
  }

  const email = normalizeEmail(payload.email);
  if (!looksLikeEmail(email) || isBlockedEmail(email)) {
    throw new Error('Enter a valid email address');
  }

  const note = String(payload.note || '').trim();
  const existingCandidate = await db.single('v2_email_candidates', {
    filters: [eq('lead_id', leadId), eq('email_address', email), eq('is_current', true)],
  });

  const candidatePatch = {
    trust_score: Math.max(Number(existingCandidate?.trust_score || 0), 55),
    trust_reasons: buildOperatorReasons(existingCandidate?.trust_reasons, '+55 manually added by operator'),
    is_manual_sendable: true,
    is_research_only: false,
    rejected_reason: null,
  };

  let candidate = existingCandidate;

  if (!candidate) {
    const [insertedCandidate] = await db.insert('v2_email_candidates', {
      lead_id: leadId,
      run_id: null,
      email_address: email,
      domain: getDomainFromEmail(email),
      local_part: getLocalPart(email),
      person_name: null,
      person_role: null,
      person_name_match: false,
      person_token_in_local: false,
      company_token_in_domain: false,
      provenance_source: 'manual',
      provenance_url: null,
      provenance_page_type: 'operator',
      provenance_extraction_method: 'manual_entry',
      provenance_page_title: 'Operator entry',
      provenance_page_heading: '',
      provenance_raw_context: note || 'Manually added by operator',
      provenance_crawl_ref: null,
      provenance_stale_penalty: 0,
      provenance_stale_reasons: [],
      provenance_domain_health_at_discovery: null,
      trust_score: candidatePatch.trust_score,
      trust_reasons: candidatePatch.trust_reasons,
      is_auto_sendable: false,
      is_manual_sendable: true,
      is_research_only: false,
      is_current: true,
      is_primary: false,
      is_fallback: false,
      selection_reason: null,
      rejected_reason: null,
      discovered_at: nowIso(),
    });
    candidate = insertedCandidate;
  } else {
    const [updatedCandidate] = await db.update('v2_email_candidates', [`id=eq.${candidate.id}`], candidatePatch);
    candidate = updatedCandidate || { ...candidate, ...candidatePatch };
  }

  return applyOperatorRoute(
    db,
    lead,
    candidate,
    actorId,
    'operator_manual_email_added',
    { manual_note: note || null },
  );
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
