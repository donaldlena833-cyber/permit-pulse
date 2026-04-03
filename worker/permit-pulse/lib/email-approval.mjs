import { isDirectoryEmailDomain } from './email.mjs';
import { getBaseDomain } from './utils.mjs';

export function isPublishedEmailCandidate(candidate) {
  return candidate?.provenance_source !== 'pattern_guess';
}

export function isOfficialSitePublishedContact(candidate, lead = null) {
  if (!candidate || !lead || !isPublishedEmailCandidate(candidate)) {
    return false;
  }

  const officialDomain = getBaseDomain(lead.company_domain || lead.company_website || '');
  const sourceDomain = getBaseDomain(candidate.provenance_url || '');

  if (!officialDomain || !sourceDomain || officialDomain !== sourceDomain) {
    return false;
  }

  if (candidate.provenance_source === 'manual') {
    return false;
  }

  if (isDirectoryEmailDomain(candidate.domain || '') || isDirectoryEmailDomain(sourceDomain)) {
    return false;
  }

  const strongPage = candidate.provenance_page_type === 'contact'
    || ['about', 'team', 'homepage'].includes(candidate.provenance_page_type || '')
    || candidate.provenance_extraction_method === 'mailto_link';

  return strongPage;
}

export function isApprovedRouteCandidate(candidate, lead = null) {
  if (!candidate) {
    return false;
  }

  if (candidate.is_auto_sendable || candidate.is_manual_sendable) {
    return true;
  }

  const domainHealth = Number(candidate.provenance_domain_health_at_discovery || 0);
  if (domainHealth <= 0) {
    return false;
  }

  return isOfficialSitePublishedContact(candidate, lead);
}

export function isAutoSendRouteCandidate(candidate, lead = null) {
  if (!candidate) {
    return false;
  }

  if (candidate.is_auto_sendable) {
    return true;
  }

  const domainHealth = Number(candidate.provenance_domain_health_at_discovery || 0);
  if (domainHealth <= 0) {
    return false;
  }

  return isOfficialSitePublishedContact(candidate, lead);
}

export function withApprovedTrustFloor(candidate, lead, trust, reasons = []) {
  if (!isOfficialSitePublishedContact(candidate, lead)) {
    return {
      trust,
      reasons,
    };
  }

  const nextTrust = Math.max(Number(trust || 0), 38);
  const nextReasons = reasons.includes('+38 official site published contact')
    ? reasons
    : ['+38 official site published contact', ...reasons];

  return {
    trust: nextTrust,
    reasons: nextReasons,
  };
}
