import { appendLeadEvent } from '../lib/events.mjs';
import { isGenericInbox, normalizeEmail } from '../lib/email.mjs';
import { eq, order } from '../lib/supabase.mjs';
import { daysSince, getBaseDomain, normalizeText } from '../lib/utils.mjs';

function computeQualityTier(lead, primaryCandidate) {
  const relevanceScore = Number(lead.relevance_score || 0);
  const trust = Number(primaryCandidate?.trust_score || 0);
  const recency = daysSince(lead.filing_date);

  if (
    relevanceScore >= 0.8
    && trust >= 50
    && primaryCandidate?.person_role === 'gc_applicant'
    && recency <= 30
  ) {
    return 'hot';
  }

  if (relevanceScore >= 0.4 && trust >= 25 && primaryCandidate?.email_address) {
    return 'warm';
  }

  return 'cold';
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const trustDelta = Number(right.trust_score || 0) - Number(left.trust_score || 0);
    if (trustDelta !== 0) {
      return trustDelta;
    }
    return Number(new Date(right.discovered_at || 0).getTime()) - Number(new Date(left.discovered_at || 0).getTime());
  });
}

function isPublishedContact(candidate) {
  return candidate?.provenance_source !== 'pattern_guess';
}

function isSendApproved(candidate) {
  return Boolean(candidate?.is_auto_sendable || candidate?.is_manual_sendable);
}

function chosenCompanyDomain(candidate) {
  return getBaseDomain(candidate?.domain || candidate?.website || '');
}

function detectResolverConflict(companyCandidates, primaryCandidate) {
  if (!primaryCandidate?.email_address) {
    return { conflict: false, reason: null };
  }

  const ordered = [...companyCandidates].sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0));
  const chosen = ordered.find((candidate) => candidate.is_chosen) || ordered[0] || null;
  const runnerUp = ordered.find((candidate) => candidate.id !== chosen?.id) || null;
  const chosenDomain = normalizeText(chosenCompanyDomain(chosen));
  const runnerUpDomain = normalizeText(chosenCompanyDomain(runnerUp));
  const confidenceDelta = Number(chosen?.confidence || 0) - Number(runnerUp?.confidence || 0);

  if (!chosen?.website) {
    return { conflict: true, reason: 'Chosen company has no website' };
  }

  if (Number(chosen?.confidence || 0) < 50) {
    return { conflict: true, reason: 'Chosen company confidence is below 50' };
  }

  if (runnerUp && runnerUpDomain && runnerUpDomain !== chosenDomain && confidenceDelta <= 10) {
    return { conflict: true, reason: 'Runner-up company is too close to the winner' };
  }

  return { conflict: false, reason: null };
}

function pickPreferredPublished(candidates) {
  const ordered = sortCandidates(candidates);
  return (
    ordered.find((candidate) => candidate.provenance_page_type === 'contact' && candidate.provenance_extraction_method === 'mailto_link')
    || ordered.find((candidate) => candidate.provenance_page_type === 'contact')
    || ordered.find((candidate) => ['about', 'team'].includes(candidate.provenance_page_type))
    || ordered[0]
    || null
  );
}

export async function selectLeadRoute(db, runId, leadId, config = {}) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    return null;
  }

  const candidates = await db.select('v2_email_candidates', {
    filters: [eq('lead_id', leadId), eq('is_current', true)],
    ordering: [order('trust_score', 'desc')],
  });
  const companyCandidates = await db.select('v2_company_candidates', {
    filters: [eq('lead_id', leadId), eq('is_current', true)],
    ordering: [order('confidence', 'desc')],
  });

  const autoSendPolicy = config.auto_send_policy === 'threshold' ? 'threshold' : 'any_published';
  const publishedCandidates = sortCandidates(candidates.filter(isPublishedContact));
  const operatorPreferredCandidate = lead.operator_vouched && lead.contact_email
    ? candidates.find((candidate) => normalizeEmail(candidate.email_address) === normalizeEmail(lead.contact_email))
    : null;
  const approvedCandidates = sortCandidates(
    candidates.filter((candidate) => !candidate.is_research_only && isSendApproved(candidate)),
  );

  const approvedPrimary = operatorPreferredCandidate
    || approvedCandidates.find((candidate) => !isGenericInbox(candidate.local_part))
    || approvedCandidates[0]
    || null;
  const approvedFallback = approvedCandidates.find((candidate) => candidate.id !== approvedPrimary?.id) || null;
  const discoveredPrimary = operatorPreferredCandidate || approvedPrimary || pickPreferredPublished(publishedCandidates);
  const discoveredFallback = approvedFallback
    || publishedCandidates.find((candidate) => candidate.id !== discoveredPrimary?.id)
    || null;
  const resolverConflict = detectResolverConflict(companyCandidates, discoveredPrimary);

  for (const candidate of candidates) {
    const isPrimary = candidate.id === discoveredPrimary?.id;
    const isFallback = candidate.id === discoveredFallback?.id;
    let rejectedReason = null;
    let selectionReason = null;

    if (candidate.id === approvedPrimary?.id) {
      selectionReason = 'Highest trust non generic candidate';
    } else if (candidate.id === approvedFallback?.id) {
      selectionReason = 'Best remaining fallback candidate';
    } else if (isPrimary) {
      selectionReason = 'Best discovered published contact';
    } else if (isFallback) {
      selectionReason = 'Alternate discovered published contact';
    } else if (approvedPrimary) {
      rejectedReason = 'Lower trust than selected route';
    } else if (isPublishedContact(candidate)) {
      rejectedReason = 'Published contact kept as discovered evidence';
    } else {
      rejectedReason = 'Pattern guess only';
    }

    await db.update('v2_email_candidates', [`id=eq.${candidate.id}`], {
      is_primary: isPrimary,
      is_fallback: isFallback,
      selection_reason: selectionReason,
      rejected_reason: rejectedReason,
    });
  }

  const qualityTier = computeQualityTier(lead, approvedPrimary || discoveredPrimary);
  const nextStatus = resolverConflict.conflict
    ? 'review'
    : approvedPrimary?.is_auto_sendable
      ? 'ready'
      : discoveredPrimary?.email_address
        ? autoSendPolicy === 'any_published'
          ? 'ready'
          : 'review'
        : 'email_required';
  const projectedLead = {
    contact_name: discoveredPrimary?.person_name || lead.applicant_name || lead.owner_name || '',
    contact_role: discoveredPrimary?.person_role || (lead.applicant_name ? 'gc_applicant' : lead.owner_name ? 'owner' : 'unknown'),
    contact_email: discoveredPrimary?.email_address || '',
    contact_email_trust: Number(discoveredPrimary?.trust_score || 0),
    fallback_email: discoveredFallback?.email_address || '',
    fallback_email_trust: Number(discoveredFallback?.trust_score || 0),
    active_email_role: 'primary',
    quality_tier: qualityTier,
    status: nextStatus,
    updated_at: new Date().toISOString(),
  };

  await db.update('v2_leads', [`id=eq.${leadId}`], projectedLead);

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'email_selected',
    detail: {
      primary: discoveredPrimary?.email_address || null,
      fallback: discoveredFallback?.email_address || null,
      send_route_primary: approvedPrimary?.email_address || null,
      primary_trust: Number(discoveredPrimary?.trust_score || 0),
      resolver_conflict: resolverConflict.conflict,
      resolver_conflict_reason: resolverConflict.reason,
    },
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'status_changed',
    detail: {
      status: projectedLead.status,
      quality_tier: qualityTier,
    },
  });

  return {
    ...lead,
    ...projectedLead,
  };
}
