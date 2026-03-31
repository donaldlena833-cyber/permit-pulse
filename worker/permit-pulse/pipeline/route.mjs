import { appendLeadEvent } from '../lib/events.mjs';
import { isGenericInbox, normalizeEmail } from '../lib/email.mjs';
import { eq, order } from '../lib/supabase.mjs';
import { daysSince } from '../lib/utils.mjs';

const EMAIL_REQUIRED_MARKER = '[email_required]';

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

function isTrustedPublished(candidate) {
  return isPublishedContact(candidate) && isSendApproved(candidate);
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

function withoutEmailRequiredMarker(operatorNotes = '') {
  return String(operatorNotes || '').replace(EMAIL_REQUIRED_MARKER, '').replace(/^\s+/, '').trim();
}

function withEmailRequiredMarker(operatorNotes = '') {
  const cleaned = withoutEmailRequiredMarker(operatorNotes);
  return cleaned ? `${EMAIL_REQUIRED_MARKER}\n${cleaned}` : EMAIL_REQUIRED_MARKER;
}

function isEmailRequiredConstraintError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('v2_leads_status_check') && message.includes('email_required');
}

async function updateLeadRoute(db, leadId, lead, projectedLead) {
  try {
    await db.update('v2_leads', [`id=eq.${leadId}`], projectedLead);
    return projectedLead;
  } catch (error) {
    if (projectedLead.status !== 'email_required' || !isEmailRequiredConstraintError(error)) {
      throw error;
    }

    const legacyProjectedLead = {
      ...projectedLead,
      status: 'review',
      operator_notes: withEmailRequiredMarker(lead.operator_notes),
      updated_at: new Date().toISOString(),
    };

    await db.update('v2_leads', [`id=eq.${leadId}`], legacyProjectedLead);
    return legacyProjectedLead;
  }
}

export async function selectLeadRoute(db, runId, leadId) {
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

  const trustedPublishedCandidates = sortCandidates(candidates.filter(isTrustedPublished));
  const publishedCandidates = sortCandidates(candidates.filter(isPublishedContact));
  const operatorPreferredCandidate = lead.operator_vouched && lead.contact_email
    ? candidates.find((candidate) => normalizeEmail(candidate.email_address) === normalizeEmail(lead.contact_email))
    : null;
  const approvedCandidates = sortCandidates(
    candidates.filter((candidate) => Number(candidate.trust_score || 0) >= 25 && !candidate.is_research_only && isSendApproved(candidate)),
  );

  const approvedPrimary = operatorPreferredCandidate
    || approvedCandidates.find((candidate) => !isGenericInbox(candidate.local_part))
    || approvedCandidates[0]
    || null;
  const approvedFallback = approvedCandidates.find((candidate) => candidate.id !== approvedPrimary?.id && Number(candidate.trust_score || 0) >= 20) || null;
  const discoveredPrimary = pickPreferredPublished(publishedCandidates);
  const discoveredFallback = trustedPublishedCandidates.find((candidate) => candidate.id !== discoveredPrimary?.id)
    || publishedCandidates.find((candidate) => candidate.id !== discoveredPrimary?.id)
    || null;
  const routePrimary = approvedPrimary || discoveredPrimary;
  const routeFallback = approvedFallback
    || [discoveredFallback, ...publishedCandidates].find((candidate) => candidate && candidate.id !== routePrimary?.id)
    || null;

  for (const candidate of candidates) {
    const isPrimary = candidate.id === routePrimary?.id;
    const isFallback = candidate.id === routeFallback?.id;
    let rejectedReason = null;
    let selectionReason = null;

    if (candidate.id === approvedPrimary?.id) {
      selectionReason = 'Selected approved send route';
    } else if (candidate.id === approvedFallback?.id) {
      selectionReason = 'Selected approved fallback route';
    } else if (candidate.id === discoveredPrimary?.id) {
      selectionReason = 'Best discovered published contact';
    } else if (candidate.id === discoveredFallback?.id) {
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

  const qualityTier = computeQualityTier(lead, routePrimary);
  const nextStatus = routePrimary?.email_address
    ? approvedPrimary?.is_auto_sendable
      ? 'ready'
      : 'review'
    : 'archived';
  const projectedLead = {
    contact_name: routePrimary?.person_name || lead.applicant_name || lead.owner_name || '',
    contact_role: routePrimary?.person_role || (lead.applicant_name ? 'gc_applicant' : lead.owner_name ? 'owner' : 'unknown'),
    contact_email: routePrimary?.email_address || '',
    contact_email_trust: Number(routePrimary?.trust_score || 0),
    fallback_email: routeFallback?.email_address || '',
    fallback_email_trust: Number(routeFallback?.trust_score || 0),
    active_email_role: 'primary',
    quality_tier: qualityTier,
    status: nextStatus,
    operator_notes: withoutEmailRequiredMarker(lead.operator_notes),
    updated_at: new Date().toISOString(),
  };

  const persistedLead = await updateLeadRoute(db, leadId, lead, projectedLead);

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'email_selected',
    detail: {
      primary: discoveredPrimary?.email_address || null,
      fallback: discoveredFallback?.email_address || null,
      send_route_primary: approvedPrimary?.email_address || null,
      primary_trust: Number(discoveredPrimary?.trust_score || 0),
    },
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'status_changed',
    detail: {
      status: persistedLead.status,
      quality_tier: qualityTier,
      reason: routePrimary?.email_address ? null : 'no_published_email_auto_archived',
    },
  });

  return {
    ...lead,
    ...persistedLead,
  };
}
