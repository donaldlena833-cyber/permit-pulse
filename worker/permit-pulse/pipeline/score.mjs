import { checkDomainHealth } from '../lib/dns.mjs';
import { isDirectoryEmailDomain, isFreeMailbox, isGenericInbox, normalizeEmail } from '../lib/email.mjs';
import { getAppConfig } from '../lib/config.mjs';
import { eq } from '../lib/supabase.mjs';
import { daysAgo, getBaseDomain } from '../lib/utils.mjs';

function isPublishedCandidate(candidate) {
  return candidate?.provenance_source !== 'pattern_guess';
}

export function scoreEmail(candidate, domainHealth, domainReputation, lead = null, config = {}) {
  let trust = 0;
  const reasons = [];
  const candidateDomain = getBaseDomain(candidate.domain || '');
  const sourceDomain = getBaseDomain(candidate.provenance_url || '');
  const officialDomain = getBaseDomain(lead?.company_domain || lead?.company_website || '');
  const matchesSourceDomain = Boolean(sourceDomain) && sourceDomain === candidateDomain;
  const matchesChosenCompanyDomain = Boolean(officialDomain) && officialDomain === candidateDomain;
  const isDirectoryRecipient = isDirectoryEmailDomain(candidateDomain);
  const isDirectorySource = Boolean(sourceDomain) && isDirectoryEmailDomain(sourceDomain);
  const autoSendThreshold = Math.max(0, Number(config.auto_send_trust_threshold ?? 50));
  const manualSendThreshold = Math.max(0, Number(config.manual_send_trust_threshold ?? 25));
  const autoSendPolicy = config.auto_send_policy === 'threshold' ? 'threshold' : 'any_published';

  if (!domainHealth || domainHealth.health_score === 0) {
    return {
      trust: 0,
      reasons: ['Domain has no MX records'],
      auto_sendable: false,
      manual_sendable: false,
      research_only: true,
    };
  }

  if (isDirectoryRecipient) {
    return {
      trust: 0,
      reasons: ['Directory or marketplace recipient domain'],
      auto_sendable: false,
      manual_sendable: false,
      research_only: true,
    };
  }

  if (domainHealth.is_parked) {
    return {
      trust: 0,
      reasons: ['Domain is parked'],
      auto_sendable: false,
      manual_sendable: false,
      research_only: true,
    };
  }

  if (candidate.provenance_page_type === 'contact' && candidate.provenance_extraction_method === 'mailto_link') {
    trust += 25; reasons.push('+25 mailto on contact page');
  } else if (candidate.provenance_page_type === 'contact') {
    trust += 20; reasons.push('+20 found on contact page');
  } else if (['about', 'team'].includes(candidate.provenance_page_type)) {
    trust += 18; reasons.push('+18 found on about/team page');
  } else if (candidate.provenance_page_type === 'footer') {
    trust += 10; reasons.push('+10 found in site footer');
  } else if (candidate.provenance_source === 'google_maps') {
    trust += 5; reasons.push('+5 Google Maps (low confidence source)');
  } else if (candidate.provenance_source === 'manual') {
    trust += 30; reasons.push('+30 manually entered');
  } else if (['blog', 'other'].includes(candidate.provenance_page_type)) {
    trust += 3; reasons.push('+3 non-primary page');
  }

  if (candidate.provenance_source === 'direct_fetch') {
    trust += 8; reasons.push('+8 direct fetch source');
  }
  if (matchesSourceDomain) {
    trust += 12; reasons.push('+12 email domain matches source site');
  }
  if (candidate.provenance_extraction_method === 'mailto_link' && matchesSourceDomain) {
    trust += 8; reasons.push('+8 matching-domain mailto');
  }

  if (candidate.company_token_in_domain) {
    trust += 10; reasons.push('+10 domain matches company');
  }
  if (matchesChosenCompanyDomain) {
    trust += 15; reasons.push('+15 email domain matches chosen company');
  }
  if (candidate.person_name_match) {
    trust += 15; reasons.push('+15 person name matches permit');
  }
  if (candidate.person_token_in_local) {
    trust += 5; reasons.push('+5 person name in email');
  }

  if (domainReputation && Number(domainReputation.reputation_score || 0) >= 70) {
    trust += 10; reasons.push('+10 good domain send history');
  }

  if (candidate.provenance_source === 'pattern_guess') {
    trust -= 30; reasons.push('-30 pattern guessed');
  }
  if (officialDomain && !matchesChosenCompanyDomain && candidate.provenance_source !== 'manual') {
    trust -= 25; reasons.push('-25 email domain does not match chosen company');
  }
  if (isDirectorySource) {
    trust -= 10; reasons.push('-10 discovered on directory source');
  }
  if (isFreeMailbox(candidate.domain)) {
    trust -= 25; reasons.push('-25 free mailbox');
  }
  if (isGenericInbox(candidate.local_part)) {
    trust -= 15; reasons.push('-15 generic inbox');
  }
  if (Number(candidate.provenance_stale_penalty || 0) > 0) {
    trust -= Number(candidate.provenance_stale_penalty || 0);
    reasons.push(`-${Number(candidate.provenance_stale_penalty || 0)} stale page`);
  }
  if (Number(domainHealth.health_score || 0) < 50) {
    trust -= 10; reasons.push('-10 weak domain');
  }
  if (domainReputation && Number(domainReputation.reputation_score || 0) < 30) {
    trust -= 15; reasons.push('-15 bad domain history');
  }
  if (!candidate.person_name_match && !candidate.person_token_in_local) {
    trust -= 5; reasons.push('-5 no person alignment');
  }

  const ageDays = daysAgo(candidate.discovered_at);
  let decay = 1.0;
  if (ageDays > 60) decay = 0.3;
  else if (ageDays > 30) decay = 0.5;
  else if (ageDays > 14) decay = 0.7;
  else if (ageDays > 7) decay = 0.85;
  else if (ageDays > 3) decay = 0.95;

  if (decay < 1.0) {
    const lost = Math.round(trust * (1 - decay));
    trust = Math.round(trust * decay);
    reasons.push(`-${lost} time decay (${Math.round(ageDays)}d)`);
  }

  trust = Math.max(trust, 0);
  const isGuessed = candidate.provenance_source === 'pattern_guess';
  const isFree = isFreeMailbox(candidate.domain);
  const canAutoSendByDomain = !officialDomain || matchesChosenCompanyDomain;
  const isPublished = isPublishedCandidate(candidate);
  const canAutoSendPublished = autoSendPolicy === 'any_published'
    && isPublished
    && candidate.provenance_source !== 'manual'
    && !isGuessed
    && !isFree
    && !isDirectoryRecipient
    && canAutoSendByDomain
    && trust >= manualSendThreshold;
  const autoSendableByThreshold = trust >= autoSendThreshold && !isGuessed && !isFree && canAutoSendByDomain;
  const manualSendable = trust >= manualSendThreshold && !isGuessed && !isDirectoryRecipient;

  return {
    trust,
    reasons,
    auto_sendable: autoSendableByThreshold || canAutoSendPublished,
    manual_sendable: manualSendable,
    research_only: trust < manualSendThreshold || isGuessed || isDirectoryRecipient,
  };
}

async function loadDomainReputation(db, domain) {
  return db.single('v2_domain_reputation', {
    filters: [eq('domain', domain)],
  });
}

export async function scoreLeadEmails(env, db, runId, leadId, config = null) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  const resolvedConfig = config || await getAppConfig(db);
  const candidates = await db.select('v2_email_candidates', {
    filters: [eq('lead_id', leadId), eq('is_current', true)],
    ordering: ['order=discovered_at.desc'],
  });

  let scored = 0;

  for (const candidate of candidates) {
    const [domainHealth, domainReputation] = await Promise.all([
      checkDomainHealth(env, candidate.domain),
      loadDomainReputation(db, candidate.domain),
    ]);
    const score = scoreEmail(candidate, domainHealth, domainReputation, lead, resolvedConfig);
    const isOperatorApprovedRoute = Boolean(lead?.operator_vouched)
      && normalizeEmail(candidate.email_address) === normalizeEmail(lead?.contact_email || '');

    if (isOperatorApprovedRoute) {
      score.trust = Math.max(score.trust, 45);
      score.reasons = ['+45 operator approved route', ...score.reasons.filter((reason) => reason !== '+45 operator approved route')];
      score.manual_sendable = true;
      score.research_only = false;
    }

    await db.update('v2_email_candidates', [`id=eq.${candidate.id}`], {
      trust_score: score.trust,
      trust_reasons: score.reasons,
      is_auto_sendable: score.auto_sendable,
      is_manual_sendable: score.manual_sendable,
      is_research_only: score.research_only,
      run_id: runId,
      provenance_domain_health_at_discovery: domainHealth?.health_score ?? 0,
    });
    scored += 1;
  }

  return {
    scored,
  };
}
