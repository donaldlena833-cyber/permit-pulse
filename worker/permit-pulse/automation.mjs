import {
  API_ENDPOINTS,
  DEFAULT_SCAN_LIMIT,
  DEFAULT_SCAN_WINDOW_DAYS,
  getAutoSendLimits,
  HIGH_VALUE_SCORE,
  METROGLASS_PROFILE,
  MIN_RELEVANCE_THRESHOLD,
  NYC_BUSINESS_HOURS,
  NYC_TIME_ZONE,
  PERMIT_RELEVANCE_RULES,
  PLUGIN_LINES,
} from './config.mjs';
import { createSupabaseGateway, eq, gte, order } from './supabase.mjs';
import { hasGmailAutomation, sendAutomationEmail } from './gmail.mjs';

function normalizeText(value) {
  return (value || '').toLowerCase().trim();
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value || '0').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function createId() {
  return crypto.randomUUID();
}

const ENRICHMENT_BATCH_LIMIT = 4;
const SEND_BATCH_LIMIT = 6;
const AUTO_SEND_ENABLED = true;
const ZEROBOUNCE_ENABLED = false;
const AUTO_SEND_EMAIL_SCORE_THRESHOLD = 70;
const AUTO_SEND_EMAIL_CONTACT_LIMIT = 3;
const DEFAULT_JOB_MAX_ATTEMPTS = 3;
const JOB_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const DIRECTORY_DOMAIN_DENYLIST = [
  'yelp.com',
  'angi.com',
  'angieslist.com',
  'houzz.com',
  'yellowpages.com',
  'superpages.com',
  'mapquest.com',
  'manta.com',
  'facebook.com',
  'linkedin.com',
  'instagram.com',
  'bbb.org',
  'dnb.com',
  'buzzfile.com',
  'bizapedia.com',
  'buildzoom.com',
  'bldup.com',
  'opencorporates.com',
  'chamberofcommerce.com',
  'nextdoor.com',
  'zoominfo.com',
  'crunchbase.com',
  'constructionjournal.com',
  'thebluebook.com',
  'alignable.com',
  'contactout.com',
  'rocketreach.co',
  'rocketreach.io',
  'lusha.com',
  'seamless.ai',
  'hunter.io',
  'skrapp.io',
  'salesintel.io',
  'adapt.io',
  'apollo.io',
];
const EMAIL_PLATFORM_DOMAIN_DENYLIST = [
  'webflow.io',
  'wix.com',
  'wixsite.com',
  'squarespace.com',
  'wordpress.com',
  'weebly.com',
  'godaddysites.com',
];
const FREE_MAILBOX_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
];
const PLACEHOLDER_EMAIL_LOCALS = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'example',
  'sample',
  'test',
  'demo',
  'invalid',
  'yourname',
  'email',
  'mail',
];

function summarizeError(error) {
  return error instanceof Error ? error.message : String(error || 'Automation step failed');
}

function detectJobProvider(error, fallback = 'worker') {
  const message = normalizeText(summarizeError(error));

  if (message.includes('supabase')) {
    return 'supabase';
  }
  if (message.includes('gmail')) {
    return 'gmail';
  }
  if (message.includes('brave')) {
    return 'brave';
  }
  if (message.includes('google') || message.includes('maps') || message.includes('geocode')) {
    return 'google-maps';
  }
  if (message.includes('firecrawl')) {
    return 'firecrawl';
  }
  if (message.includes('zerobounce')) {
    return 'zerobounce';
  }
  if (message.includes('dob') || message.includes('data.cityofnewyork') || message.includes('rbx6-tga4')) {
    return 'dob';
  }

  return fallback;
}

function computeNextRetryAt(attemptCount) {
  const delay = JOB_RETRY_DELAYS_MS[Math.max(0, Math.min(attemptCount - 1, JOB_RETRY_DELAYS_MS.length - 1))];
  return new Date(Date.now() + delay).toISOString();
}

function normalizeJobSnapshot(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  return value;
}

function summarizeJobResult(result) {
  if (!result || typeof result !== 'object') {
    return { value: result ?? null };
  }

  return JSON.parse(JSON.stringify(result));
}

function getJobAttemptCount(job) {
  return Number(job?.attempt_count || job?.attemptCount || 0);
}

function getJobMaxAttempts(config, job = null) {
  return Math.max(
    Number(config.maxAttempts || job?.max_attempts || job?.maxAttempts || DEFAULT_JOB_MAX_ATTEMPTS),
    1,
  );
}

async function runAutomationJob(gateway, config, work, options = {}) {
  const startedAt = new Date().toISOString();
  const existingJob = options.existingJob || null;
  let job = existingJob;
  const maxAttempts = getJobMaxAttempts(config, existingJob);
  const inputSnapshot = normalizeJobSnapshot(config.inputSnapshot || existingJob?.input_snapshot || existingJob?.inputSnapshot || {}, {});

  if (existingJob) {
    const nextAttemptCount = Math.max(getJobAttemptCount(existingJob) + 1, 1);
    const patched = await gateway.safePatchAutomationJob(existingJob.id, {
      status: 'running',
      run_id: config.runId || existingJob.run_id || existingJob.runId || existingJob.id,
      parent_job_id: config.parentJobId ?? existingJob.parent_job_id ?? existingJob.parentJobId ?? null,
      provider: config.provider || existingJob.provider || 'worker',
      summary: config.summary || existingJob.summary || '',
      detail: config.detail || existingJob.detail || '',
      retryable: Boolean(config.retryable),
      attempt_count: nextAttemptCount,
      max_attempts: maxAttempts,
      input_snapshot: inputSnapshot,
      output_snapshot: {},
      error_code: null,
      error_message: null,
      next_retry_at: null,
      started_at: startedAt,
      finished_at: null,
      metadata: {
        ...(existingJob.metadata || {}),
        ...(config.metadata || {}),
        retriedAt: startedAt,
      },
    });
    job = patched[0] || {
      ...existingJob,
      status: 'running',
      attempt_count: nextAttemptCount,
      max_attempts: maxAttempts,
      input_snapshot: inputSnapshot,
      error_code: null,
      error_message: null,
      next_retry_at: null,
      started_at: startedAt,
      finished_at: null,
    };
  } else {
    const inserted = await gateway.safeInsertAutomationJob({
      id: createId(),
      run_id: config.runId || null,
      parent_job_id: config.parentJobId || null,
      lead_id: config.leadId || null,
      job_type: config.jobType,
      status: 'running',
      provider: config.provider || 'worker',
      summary: config.summary,
      detail: config.detail || '',
      attempt_count: 1,
      max_attempts: maxAttempts,
      retryable: Boolean(config.retryable),
      input_snapshot: inputSnapshot,
      output_snapshot: {},
      error_code: null,
      error_message: null,
      metadata: config.metadata || {},
      started_at: startedAt,
      finished_at: null,
      next_retry_at: null,
    });
    job = inserted[0] || null;
  }

  try {
    const result = await work(job);
    const successPayload =
      typeof config.onSuccess === 'function'
        ? config.onSuccess(result)
        : {};

    if (job?.id) {
      await gateway.safePatchAutomationJob(job.id, {
        status: 'succeeded',
        run_id: config.runId || job.run_id || job.runId || job.id,
        parent_job_id: config.parentJobId ?? job.parent_job_id ?? job.parentJobId ?? null,
        provider: successPayload.provider || config.provider || job.provider || 'worker',
        summary: successPayload.summary || config.summary,
        detail: successPayload.detail || config.detail || '',
        retryable: false,
        finished_at: new Date().toISOString(),
        output_snapshot: normalizeJobSnapshot(successPayload.outputSnapshot || summarizeJobResult(result), {}),
        next_retry_at: null,
        metadata: {
          ...(job.metadata || {}),
          ...(successPayload.metadata || {}),
        },
      });
    }

    return result;
  } catch (error) {
    if (job?.id) {
      const attemptCount = getJobAttemptCount(job) || 1;
      const canRetry = Boolean(config.retryable) && attemptCount < maxAttempts;
      await gateway.safePatchAutomationJob(job.id, {
        status: canRetry ? 'retrying' : 'failed',
        provider: detectJobProvider(error, config.provider || job.provider || 'worker'),
        detail: summarizeError(error),
        retryable: canRetry,
        finished_at: new Date().toISOString(),
        error_code: detectJobProvider(error, config.provider || job.provider || 'worker'),
        error_message: summarizeError(error),
        next_retry_at: canRetry ? computeNextRetryAt(attemptCount) : null,
        metadata: {
          ...(job.metadata || {}),
          error: summarizeError(error),
        },
      });
    }

    throw error;
  }
}

async function queueAutomationJob(gateway, payload) {
  const inserted = await gateway.safeInsertAutomationJob({
    id: payload.id || createId(),
    run_id: payload.runId || null,
    parent_job_id: payload.parentJobId || null,
    lead_id: payload.leadId || null,
    job_type: payload.jobType,
    status: payload.status || 'queued',
    provider: payload.provider || 'worker',
    summary: payload.summary || '',
    detail: payload.detail || '',
    attempt_count: payload.attemptCount || 0,
    max_attempts: payload.maxAttempts || DEFAULT_JOB_MAX_ATTEMPTS,
    retryable: Boolean(payload.retryable),
    input_snapshot: normalizeJobSnapshot(payload.inputSnapshot || {}, {}),
    output_snapshot: normalizeJobSnapshot(payload.outputSnapshot || {}, {}),
    error_code: payload.errorCode || null,
    error_message: payload.errorMessage || null,
    metadata: payload.metadata || {},
    started_at: payload.startedAt || null,
    finished_at: payload.finishedAt || null,
    next_retry_at: payload.nextRetryAt || null,
  });

  return inserted[0] || null;
}

function getPermitKey(permit) {
  return (
    permit.job_filing_number ||
    [permit.block, permit.lot, permit.house_no, permit.street_name, permit.issued_date].filter(Boolean).join(':')
  );
}

function getApplicantName(permit) {
  return (
    permit.applicant_business_name ||
    [permit.applicant_first_name, permit.applicant_middle_name, permit.applicant_last_name].filter(Boolean).join(' ').trim()
  );
}

function getFilingRepName(permit) {
  return (
    permit.filing_representative_business_name ||
    [permit.filing_representative_first_name, permit.filing_representative_last_name].filter(Boolean).join(' ').trim()
  );
}

function getPermitAddress(permit) {
  return [permit.house_no, permit.street_name, permit.borough, permit.zip_code].filter(Boolean).join(', ');
}

function rootDomain(value) {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function originFromUrl(value) {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return url.origin;
  } catch {
    const domain = rootDomain(value);
    return domain ? `https://${domain}` : '';
  }
}

function stripCompanySuffix(value) {
  return normalizeText(value)
    .replace(/\b(llc|inc|corp|corporation|co|company|ltd|pllc|pc|architects|architecture|design|studio|contracting|construction)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emailLocalPart(email = '') {
  return normalizeText((email.split('@')[0] || '').trim());
}

function emailDomain(email = '') {
  return normalizeText((email.split('@')[1] || '').trim());
}

function normalizeEmailAddress(email = '') {
  return normalizeText(email);
}

function isFreeMailboxDomain(domain = '') {
  return FREE_MAILBOX_DOMAINS.includes(normalizeText(domain));
}

function isPlaceholderMailbox(email = '') {
  const local = emailLocalPart(email).replace(/\+/g, '');
  const domain = emailDomain(email);

  if (!local || !domain) {
    return true;
  }

  if (domain === 'example.com' || domain.endsWith('.example.com') || domain.includes('example.')) {
    return true;
  }

  return PLACEHOLDER_EMAIL_LOCALS.some((entry) =>
    local === entry
    || local.startsWith(`${entry}.`)
    || local.endsWith(`.${entry}`)
    || local.includes(`${entry}+`)
  );
}

function getKnownPersonTokens(permit) {
  return uniq([
    ...tokenizeName(permit.owner_name || ''),
    ...tokenizeName(getApplicantName(permit) || ''),
    ...tokenizeName(getFilingRepName(permit) || ''),
  ]);
}

function getKnownCompanyTokens(companyProfile, permit) {
  return uniq([
    ...tokenizeName(companyProfile?.company_name || ''),
    ...tokenizeName(permit.owner_business_name || ''),
    ...tokenizeName(permit.applicant_business_name || ''),
    ...tokenizeName(permit.filing_representative_business_name || ''),
  ]);
}

function tokenizeName(value) {
  return stripCompanySuffix(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function countTokenMatches(needles, haystack) {
  return needles.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
}

function isDirectoryDomain(domain) {
  return DIRECTORY_DOMAIN_DENYLIST.some((entry) => domain.includes(entry));
}

function isBlockedEmailDomain(domain = '') {
  const normalized = normalizeText(domain);
  return (
    isDirectoryDomain(normalized) ||
    EMAIL_PLATFORM_DOMAIN_DENYLIST.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`))
  );
}

function buildSearchableText(permit) {
  return normalizeText(
    [
      permit.job_description,
      permit.owner_name,
      permit.owner_business_name,
      permit.applicant_business_name,
      getApplicantName(permit),
      getFilingRepName(permit),
      permit.work_type,
      permit.filing_reason,
    ].join(' '),
  );
}

function countKeywordHits(text, keywords) {
  return keywords.filter((keyword) => text.includes(normalizeText(keyword)));
}

function getLeadTier(score) {
  if (score >= 55) return 'hot';
  if (score >= 30) return 'warm';
  return 'cold';
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getPluginLine(seed) {
  return PLUGIN_LINES[hashString(seed) % PLUGIN_LINES.length];
}

function getPermitRelevance(permit) {
  const searchable = normalizeText([
    permit.job_description,
    permit.work_type,
    permit.filing_reason,
  ].join(' '));

  const match = PERMIT_RELEVANCE_RULES
    .filter((rule) => searchable.includes(normalizeText(rule.keyword)))
    .sort((left, right) => right.score - left.score)[0];

  if (!match) {
    return {
      score: 0.3,
      keyword: 'general renovation',
      angle: 'custom glass scope',
    };
  }

  return {
    score: match.score,
    keyword: match.keyword,
    angle: match.angle,
  };
}

function getProjectAngle(lead) {
  if (lead?.score_breakdown?.serviceAngle) {
    return lead.score_breakdown.serviceAngle;
  }

  if (lead?.scoreBreakdown?.serviceAngle) {
    return lead.scoreBreakdown.serviceAngle;
  }

  const permit = lead.raw_permit || lead;
  return getPermitRelevance(permit).angle;
}

function sanitizeOutreachCopy(value) {
  return String(value || '')
    .replace(/[—–]/g, ', ')
    .replace(/\s-\s/g, ', ')
    .replace(/build-outs/gi, 'buildouts')
    .replace(/fit-outs/gi, 'fit outs')
    .replace(/(?<=\w)-(?=\w)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getDraftRecipientName(primaryContact, companyProfile, lead) {
  return sanitizeOutreachCopy(
    primaryContact?.name
      || companyProfile.company_name
      || permitLikeName(lead.owner_business_name)
      || permitLikeName(lead.applicant_name)
      || 'there',
  );
}

function getDraftRole(lead, companyProfile, primaryContact) {
  return normalizeText(
    primaryContact?.role
    || lead.channelDecision?.targetRole
    || companyProfile.role
    || lead.applicant_business_name
    || '',
  );
}

function chooseDraftCta(lead, role, projectAngle, relevanceScore) {
  void lead;
  void projectAngle;
  void relevanceScore;

  if (role.includes('owner') || role.includes('applicant') || role.includes('gc')) {
    return 'I know filings do not always show the full picture, but if any glass related work is still being lined up, I’d be happy to connect.';
  }

  return 'I know filings do not always show the full picture, but if any glass related work is still being lined up, I’d be happy to connect.';
}

function getDraftValueLine(role, projectAngle) {
  void projectAngle;

  if (role.includes('applicant') || role.includes('gc') || role.includes('contractor')) {
    return 'I’m with MetroGlass Pro. We work on custom glass installations across NYC, NJ, and CT, including mirrors, partitions, shower glass, cabinets, and similar scope.';
  }

  return 'I’m with MetroGlass Pro. We work on custom glass installations across NYC, NJ, and CT, including mirrors, partitions, shower glass, cabinets, and similar scope.';
}

function buildDraftIntro(lead, projectAngle, relevanceKeyword) {
  void projectAngle;
  void relevanceKeyword;

  return sanitizeOutreachCopy(`I saw the filing for ${lead.address} and wanted to reach out.`);
}

function buildLeadScore(permit) {
  const text = buildSearchableText(permit);
  const relevance = getPermitRelevance(permit);
  const directHits = countKeywordHits(text, METROGLASS_PROFILE.directKeywords);
  const inferredHits = countKeywordHits(text, METROGLASS_PROFILE.inferredKeywords);
  const commercialHits = countKeywordHits(text, METROGLASS_PROFILE.commercialKeywords);
  const negativeHits = countKeywordHits(text, METROGLASS_PROFILE.negativeKeywords);
  const cost = parseAmount(permit.estimated_job_costs);

  let directKeyword = 0;
  let inferredNeed = 0;
  let costSignal = 0;
  let commercialSignal = 0;
  let buildingTypeSignal = 0;
  let recencyBonus = 0;
  let locationBonus = 0;
  let negativeSignals = 0;
  const reasons = [];
  const disqualifiers = [];

  if (negativeHits.length > 0) {
    disqualifiers.push(`Out of scope signal: ${negativeHits[0]}`);
  }

  if (
    relevance.score < MIN_RELEVANCE_THRESHOLD &&
    directHits.length === 0 &&
    inferredHits.length === 0 &&
    commercialHits.length === 0
  ) {
    disqualifiers.push(`Permit wording is weak for glazing work, matched: ${relevance.keyword}`);
  }

  if (directHits.length >= 3) {
    directKeyword = 40;
    reasons.push(`Strong glazing match from ${directHits.slice(0, 3).join(', ')}`);
  } else if (directHits.length === 2) {
    directKeyword = 30;
    reasons.push(`Direct glazing fit from ${directHits.join(', ')}`);
  } else if (directHits.length === 1) {
    directKeyword = 20;
    reasons.push(`Explicit glass signal from ${directHits[0]}`);
  }

  if (inferredHits.length >= 2) {
    inferredNeed = 18;
    reasons.push(`Renovation language supports glass scope`);
  } else if (inferredHits.length === 1) {
    inferredNeed = 10;
    reasons.push(`Inferred fit from ${inferredHits[0]}`);
  }

  if (relevance.score >= 0.85) {
    inferredNeed = Math.max(inferredNeed, 20);
    reasons.push(`Permit pattern strongly matches ${relevance.keyword}`);
  } else if (relevance.score >= 0.6) {
    inferredNeed = Math.max(inferredNeed, 14);
    reasons.push(`Permit wording lines up with ${relevance.keyword}`);
  } else if (relevance.score >= 0.4) {
    inferredNeed = Math.max(inferredNeed, 8);
  } else if (relevance.score < MIN_RELEVANCE_THRESHOLD) {
    negativeSignals += 8;
  }

  if (commercialHits.length > 0) {
    commercialSignal = 10;
    reasons.push(`Commercial or showroom signal present`);
  }

  if (cost >= METROGLASS_PROFILE.sweetSpotMin && cost <= METROGLASS_PROFILE.sweetSpotMax) {
    costSignal = 16;
    reasons.push(`Budget lands in the sweet spot at $${Math.round(cost).toLocaleString('en-US')}`);
  } else if (cost >= METROGLASS_PROFILE.minCost) {
    costSignal = 8;
  } else {
    negativeSignals += 10;
    reasons.push('Budget is light for MetroGlass Pro');
  }

  if (METROGLASS_PROFILE.primaryBoroughs.includes(permit.borough)) {
    locationBonus = 8;
  } else if (METROGLASS_PROFILE.secondaryBoroughs.includes(permit.borough)) {
    locationBonus = 4;
  } else {
    negativeSignals += 5;
  }

  const issuedAt = permit.issued_date ? new Date(permit.issued_date) : null;
  const ageDays = issuedAt ? Math.floor((Date.now() - issuedAt.getTime()) / 86400000) : 99;
  if (ageDays <= 3) {
    recencyBonus = 10;
  } else if (ageDays <= 7) {
    recencyBonus = 6;
  } else if (ageDays > 30) {
    negativeSignals += 8;
    reasons.push('Permit is stale');
  }

  if (normalizeText(permit.job_description).includes('condo') || normalizeText(permit.job_description).includes('commercial')) {
    buildingTypeSignal = 6;
  }

  const total = clamp(
    directKeyword +
      inferredNeed +
      costSignal +
      commercialSignal +
      buildingTypeSignal +
      recencyBonus +
      locationBonus -
      negativeSignals,
  );

  const summary =
    relevance.score >= 0.85
      ? `Permit wording strongly points to ${relevance.angle}.`
      : directHits.length > 0
        ? 'Strong glazing signal in permit description.'
        : inferredHits.length > 0 || relevance.score >= 0.5
          ? 'Renovation scope suggests likely glass work.'
          : 'Moderate fit that still needs manual qualification.';

  return {
    directKeyword,
    inferredNeed,
    costSignal,
    commercialSignal,
    buildingTypeSignal,
    recencyBonus,
    locationBonus,
    negativeSignals,
    total,
    reasons,
    disqualifiers,
    summary,
    relevanceScore: relevance.score,
    relevanceKeyword: relevance.keyword,
    serviceAngle: relevance.angle,
  };
}

function buildContactability(permit, propertyProfile, companyProfile, contacts) {
  let score = 0;
  const reasons = [];
  const missing = [];

  if (permit.owner_name) {
    score += 8;
    reasons.push('Owner name present');
  } else {
    missing.push('owner name');
  }

  if (permit.owner_business_name) {
    score += 10;
    reasons.push('Owner business present');
  } else {
    missing.push('owner business');
  }

  if (getApplicantName(permit)) {
    score += 10;
    reasons.push('Applicant or GC present');
  } else {
    missing.push('applicant');
  }

  if (getFilingRepName(permit)) {
    score += 4;
  }

  if (companyProfile.website) {
    score += 12;
    reasons.push('Website resolved');
  } else {
    missing.push('website');
  }

  const directEmail = contacts.find((contact) => contact.email && contact.type === 'verified');
  const publicEmail = contacts.find(
    (contact) => contact.email && contact.type === 'public' && Number(contact.confidence || 0) >= 60,
  );
  const guessedEmail = contacts.find(
    (contact) => contact.email && contact.type === 'guessed' && Number(contact.confidence || 0) >= 42,
  );
  const phone = contacts.find((contact) => contact.phone);
  const form = contacts.find((contact) => contact.contact_form_url);
  const linkedIn = contacts.find((contact) => contact.linkedin_url);
  const instagram = contacts.find((contact) => contact.instagram_url);

  if (directEmail) {
    score += 18;
    reasons.push('Verified email available');
  } else if (publicEmail) {
    score += 14;
    reasons.push('Public email available');
  } else if (guessedEmail) {
    score += 10;
    reasons.push('Guessed email available');
  } else {
    missing.push('email');
  }

  if (phone) {
    score += 12;
    reasons.push('Phone available');
  } else {
    missing.push('phone');
  }

  if (form) {
    score += 7;
  }

  if (linkedIn) {
    score += 5;
  }

  if (instagram) {
    score += 3;
  }

  score += Math.round((companyProfile.confidence || 0) * 0.15);
  score += Math.round((propertyProfile.confidence || 0) * 0.1);

  const total = clamp(score);
  const label = total >= 80 ? 'Excellent' : total >= 60 ? 'Good' : total >= 35 ? 'Fair' : 'Weak';
  const explanation =
    label === 'Excellent'
      ? 'Multiple clean contact routes are already in place.'
      : label === 'Good'
        ? 'There is enough reachability to move into outreach quickly.'
        : label === 'Fair'
          ? 'The lead is reachable, but the contact layer still needs work.'
          : 'Research is still the bottleneck before outreach.';

  return {
    ownerPresent: permit.owner_name ? 8 : 0,
    ownerBusinessPresent: permit.owner_business_name ? 10 : 0,
    gcPresent: getApplicantName(permit) ? 10 : 0,
    filingRepPresent: getFilingRepName(permit) ? 4 : 0,
    websiteFound: companyProfile.website ? 12 : 0,
    directEmailFound: directEmail ? 18 : 0,
    genericEmailFound: publicEmail ? 14 : 0,
    phoneFound: phone ? 12 : 0,
    contactFormFound: form ? 7 : 0,
    linkedInFound: linkedIn ? 5 : 0,
    instagramFound: instagram ? 3 : 0,
    total,
    label,
    reasons,
    missing,
    explanation,
  };
}

function getRolePriority(role = '') {
  const normalized = normalizeText(role);

  if (normalized.includes('applicant') || normalized.includes('gc') || normalized.includes('contractor')) {
    return 18;
  }

  if (normalized.includes('owner')) {
    return 12;
  }

  if (normalized.includes('filing') || normalized.includes('architect') || normalized.includes('design')) {
    return 4;
  }

  return 7;
}

function isGenericMailbox(email = '') {
  const local = normalizeText(email.split('@')[0] || '');
  return ['info', 'sales', 'contact', 'hello', 'office', 'admin', 'support', 'estimating', 'billing'].includes(local);
}

function assessEmailCandidate(email, { companyProfile, permit, source = '' } = {}) {
  const normalizedEmail = normalizeEmailAddress(email);
  const domain = emailDomain(normalizedEmail);
  const local = emailLocalPart(normalizedEmail);
  const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));
  const personTokens = getKnownPersonTokens(permit || {});
  const companyTokens = getKnownCompanyTokens(companyProfile || {}, permit || {});
  const localSearchable = local.replace(/[._+-]/g, ' ');
  const personMatches = countTokenMatches(personTokens, localSearchable);
  const companyMatches = countTokenMatches(companyTokens, localSearchable);
  const matchesOfficialDomain = Boolean(
    officialDomain && (domain === officialDomain || domain.endsWith(`.${officialDomain}`)),
  );
  const freeMailbox = isFreeMailboxDomain(domain);
  const genericMailbox = isGenericMailbox(normalizedEmail);

  if (!domain || isBlockedEmailDomain(domain) || isPlaceholderMailbox(normalizedEmail)) {
    return { accept: false, confidence: 0, domain, reason: 'junk-email' };
  }

  if (!matchesOfficialDomain && !freeMailbox) {
    return { accept: false, confidence: 0, domain, reason: 'unrelated-domain' };
  }

  if (freeMailbox && personMatches === 0 && companyMatches === 0) {
    return { accept: false, confidence: 0, domain, reason: 'free-mailbox-without-match' };
  }

  let confidence = 0;

  if (matchesOfficialDomain) {
    confidence += 62;
  } else if (freeMailbox) {
    confidence += 34;
  }

  if (source === 'firecrawl') {
    confidence += 12;
  } else if (source === 'website_resolution') {
    confidence += 8;
  } else if (source === 'brave_search') {
    confidence -= 16;
  } else if (source === 'pattern_guess') {
    confidence -= 10;
  }

  if (genericMailbox) {
    confidence -= matchesOfficialDomain ? 10 : 16;
  } else {
    confidence += 8;
  }

  confidence += Math.min(12, personMatches * 6);
  confidence += Math.min(10, companyMatches * 5);

  return {
    accept: confidence >= 28,
    confidence: clamp(confidence, 0, 96),
    domain,
    genericMailbox,
    freeMailbox,
    matchesOfficialDomain,
    personMatches,
    companyMatches,
    reason: confidence >= 28 ? 'accepted' : 'low-trust',
  };
}

function isPremiumLinkedInTarget(companyProfile) {
  return METROGLASS_PROFILE.linkedinSignals.some((signal) =>
    normalizeText(companyProfile.normalized_name || companyProfile.company_name).includes(signal),
  );
}

function contactMatchesKnownPerson(contact, permit = {}) {
  const haystack = normalizeText([contact.name, contact.role, contact.email].filter(Boolean).join(' '));
  const knownPeople = getKnownPersonTokens(permit);
  return knownPeople.length > 0 && countTokenMatches(knownPeople, haystack) > 0;
}

function contactMatchesKnownCompany(contact, companyProfile = {}, permit = {}) {
  const haystack = normalizeText([
    contact.name,
    contact.role,
    contact.website_url,
    contact.linkedin_url,
    contact.source,
  ].filter(Boolean).join(' '));
  const knownCompanies = getKnownCompanyTokens(companyProfile, permit);
  return knownCompanies.length > 0 && countTokenMatches(knownCompanies, haystack) > 0;
}

function isEntityAlignedEmailContact(contact, companyProfile = {}, permit = {}) {
  if (!contact?.email) {
    return false;
  }

  const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));
  const contactDomain = emailDomain(contact.email);
  const websiteDomain = normalizeText(rootDomain(contact.website_url || ''));
  const freeMailbox = isFreeMailboxDomain(contactDomain);

  if (!contactDomain || isBlockedEmailDomain(contactDomain)) {
    return false;
  }

  if (officialDomain) {
    const directDomainMatch =
      contactDomain === officialDomain
      || contactDomain.endsWith(`.${officialDomain}`)
      || websiteDomain === officialDomain
      || websiteDomain.endsWith(`.${officialDomain}`);

    if (directDomainMatch) {
      return true;
    }
  }

  if (freeMailbox) {
    return contactMatchesKnownPerson(contact, permit);
  }

  return contactMatchesKnownCompany(contact, companyProfile, permit);
}

function scoreEmailContactForSelection(contact, companyProfile, permit = {}) {
  if (!contact?.email) {
    return -100;
  }

  const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));
  const contactDomain = emailDomain(contact.email);
  const websiteDomain = normalizeText(rootDomain(contact.website_url || ''));
  const genericMailbox = isGenericMailbox(contact.email);
  const freeMailbox = isFreeMailboxDomain(contactDomain);
  const entityAligned = isEntityAlignedEmailContact(contact, companyProfile, permit);
  const officialDomainMatch = Boolean(
    officialDomain && (contactDomain === officialDomain || contactDomain.endsWith(`.${officialDomain}`)),
  );
  const websiteDomainMatch = Boolean(
    officialDomain && websiteDomain && (websiteDomain === officialDomain || websiteDomain.endsWith(`.${officialDomain}`)),
  );

  if (!contactDomain || isBlockedEmailDomain(contactDomain)) {
    return -100;
  }

  if (!entityAligned) {
    return -100;
  }

  if (officialDomain && freeMailbox && !contact.verified && contact.source !== 'manual') {
    return -28;
  }

  let score = Math.round(contact.confidence || 0);
  score += contact.type === 'verified' ? 32 : contact.type === 'public' ? 12 : -10;
  score += contact.verified ? 10 : 0;
  score += officialDomainMatch ? 16 : freeMailbox ? -2 : -18;
  score += websiteDomainMatch ? 10 : 0;
  score += genericMailbox ? -14 : 8;
  score += entityAligned ? 12 : -24;
  score += contact.source === 'firecrawl' ? 8 : contact.source === 'manual' ? 10 : 0;
  score += contact.source === 'pattern_guess' ? -16 : 0;
  score += contact.source === 'brave_search' ? -10 : 0;

  return score;
}

function buildRouteCandidates({ companyProfile, contacts, permit }) {
  const premiumFirm = isPremiumLinkedInTarget(companyProfile);
  const candidates = [];

  contacts.forEach((contact) => {
    const role = contact.role || companyProfile.role || '';
    const rolePriority = getRolePriority(role);
    const confidence = Math.round(contact.confidence || 0);

    if (contact.email) {
      const emailSelectionScore = scoreEmailContactForSelection(contact, companyProfile, permit);
      if (emailSelectionScore <= 0) {
        return;
      }

      let score = 36 + rolePriority + Math.round(confidence * 0.18);
      score += emailSelectionScore - Math.round(confidence);

      candidates.push({
        channel: 'email',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: contact.type || 'public',
        routeSource: contact.source || '',
      });
    }

    if (contact.phone) {
      const score = 50 + rolePriority + Math.round(confidence * 0.18);
      candidates.push({
        channel: 'phone',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
      });
    }

    if (contact.contact_form_url) {
      const score = 42 + Math.round(confidence * 0.12) + Math.round((companyProfile.confidence || 0) * 0.18);
      candidates.push({
        channel: 'form',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
      });
    }

    if (contact.linkedin_url) {
      const score = (premiumFirm ? 42 : 22) + Math.round(confidence * 0.1) + Math.round(rolePriority * 0.35);
      candidates.push({
        channel: 'linkedin',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
      });
    }
  });

  if (!contacts.some((contact) => contact.linkedin_url) && companyProfile.linked_in_url) {
    candidates.push({
      channel: 'linkedin',
      score: premiumFirm ? 48 : 26,
      contact: {
        email: '',
        phone: '',
        contact_form_url: '',
        linkedin_url: companyProfile.linked_in_url,
        source: 'company_profile',
      },
      targetRole: companyProfile.role || (premiumFirm ? 'design firm' : 'company'),
      recipientType: 'public',
      routeSource: 'company_profile',
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function buildChannelReason(candidate, companyProfile, permit) {
  const routeLabel =
    candidate.targetRole && candidate.targetRole !== 'company'
      ? candidate.targetRole.replace(/_/g, ' ')
      : companyProfile.company_name || permit.owner_business_name || getApplicantName(permit) || 'team';

  if (candidate.channel === 'email') {
    if (candidate.recipientType === 'verified') {
      return `A verified ${routeLabel} email is available, which is the cleanest first route.`;
    }

    if (candidate.recipientType === 'guessed') {
      return `A guessed ${routeLabel} email exists. Review it quickly, then use email if the match still looks right.`;
    }

    return `A public ${routeLabel} email is available, which is still cleaner than a cold phone-first approach.`;
  }

  if (candidate.channel === 'phone') {
    return `A phone route exists for the ${routeLabel}, which is stronger than guessing another contact path.`;
  }

  if (candidate.channel === 'form') {
    return 'The official site has a contact route, so the form is cleaner than guessing another path.';
  }

  if (isPremiumLinkedInTarget(companyProfile)) {
    return 'Premium architect or design profile with no clean email found, so LinkedIn is worth drafting.';
  }

  return `No cleaner route exists yet for ${routeLabel}, so LinkedIn stays a research path only.`;
}

function buildChannelDecision({ score, contactability, companyProfile, contacts, permit }) {
  const routeCandidates = buildRouteCandidates({ companyProfile, contacts, permit });
  const selected = routeCandidates[0];
  const alternatives = uniq(routeCandidates.slice(1).map((candidate) => candidate.channel)).filter(Boolean);

  if (!selected) {
    return {
      primary: 'linkedin',
      reason: `No direct contact route is available yet for ${permit.owner_business_name || getApplicantName(permit) || 'this lead'}.`,
      alternatives: [],
      autoSendEligible: false,
      routeConfidence: 0,
      recipientType: '',
      targetRole: '',
      routeSource: '',
    };
  }

  const manualAutoSendEligible =
    AUTO_SEND_ENABLED &&
    selected.channel === 'email' &&
    selected.recipientType !== 'guessed' &&
    selected.score >= AUTO_SEND_EMAIL_SCORE_THRESHOLD &&
    contactability.total >= 55;

  return {
    primary: selected.channel,
    reason: buildChannelReason(selected, companyProfile, permit),
    alternatives,
    autoSendEligible: manualAutoSendEligible,
    routeConfidence: selected.score,
    recipientType: selected.recipientType,
    targetRole: selected.targetRole,
    routeSource: selected.routeSource,
  };
}

function buildOutreachReadiness(score, contactability, companyProfile, contacts, channelDecision) {
  let readiness = 0;
  const blockers = [];

  readiness += Math.round(score * 0.38);
  readiness += Math.round(contactability.total * 0.28);
  readiness += Math.round((companyProfile.confidence || 0) * 0.18);
  readiness += Math.round((channelDecision.routeConfidence || 0) * 0.16);

  if (!contacts.find((contact) => contact.email || contact.phone || contact.contact_form_url || contact.linkedin_url)) {
    blockers.push('No outreach route found');
    readiness -= 22;
  }

  if (companyProfile.match_strength === 'weak') {
    blockers.push('Company match is weak');
    readiness -= 15;
  }

  if ((companyProfile.confidence || 0) < 35) {
    blockers.push('Company confidence is too light');
  }

  if (channelDecision.primary === 'email' && channelDecision.recipientType === 'guessed') {
    blockers.push('Primary email is still guessed');
    readiness -= 8;
  }

  const scoreValue = clamp(readiness);
  const label =
    scoreValue >= 78 ? 'Ready' : scoreValue >= 58 ? 'Almost Ready' : scoreValue >= 38 ? 'Needs Review' : 'Blocked';
  const explanation =
    label === 'Ready'
      ? 'Enough context and route quality exist to move directly into outreach.'
      : label === 'Almost Ready'
        ? 'Close to sendable, but still worth one more pass on route quality.'
        : label === 'Needs Review'
          ? 'The lead has promise, but the best route still needs operator judgment.'
          : 'The lead needs more research before it should be touched.';

  return {
    score: scoreValue,
    label,
    explanation,
    blockers,
  };
}

function buildQualityTier({ leadRow, contactability, companyProfile, contacts }) {
  const relevanceScore = Number(leadRow.score_breakdown?.relevanceScore || 0.3);
  const ageDays = leadRow.issued_date
    ? Math.floor((Date.now() - new Date(leadRow.issued_date).getTime()) / 86400000)
    : 999;
  const hasEmail = contacts.some((contact) => contact.email);
  const hasPhone = contacts.some((contact) => contact.phone);
  const isExpired = leadRow.expiry_date ? new Date(leadRow.expiry_date).getTime() < Date.now() : false;
  const hasApplicant = Boolean(leadRow.applicant_business_name || leadRow.applicant_name);

  if (isExpired || relevanceScore < MIN_RELEVANCE_THRESHOLD || ageDays > 90) {
    return 'dead';
  }

  if (
    relevanceScore >= 0.8 &&
    hasApplicant &&
    hasEmail &&
    ageDays <= 30 &&
    companyProfile.match_strength !== 'weak'
  ) {
    return 'hot';
  }

  if (relevanceScore >= 0.5 && (hasEmail || hasPhone || contactability.total >= 40)) {
    return 'warm';
  }

  return 'cold';
}

function buildPriorityState(score, contactability, readiness) {
  const priorityScore = Math.round((score * 0.52) + (contactability.total * 0.23) + (readiness.score * 0.25));

  if (score < 20) {
    return { priorityLabel: 'Ignore', priorityScore };
  }

  if (priorityScore >= 82) {
    return { priorityLabel: 'Attack Now', priorityScore };
  }

  if (priorityScore >= 60) {
    return { priorityLabel: 'Research Today', priorityScore };
  }

  if (priorityScore >= 42) {
    return { priorityLabel: 'Worth a Try', priorityScore };
  }

  if (priorityScore >= 24) {
    return { priorityLabel: 'Monitor', priorityScore };
  }

  return { priorityLabel: 'Ignore', priorityScore };
}

function resolveLeadStatus({ currentStatus, followUpDate, hasDraft, qualityTier, readinessLabel }) {
  if (currentStatus === 'archived') {
    return 'archived';
  }

  if (qualityTier === 'dead') {
    return 'archived';
  }

  if (followUpDate) {
    return 'follow-up-due';
  }

  if (['contacted', 'replied', 'qualified', 'quoted', 'won', 'lost'].includes(currentStatus)) {
    return currentStatus;
  }

  if (currentStatus === 'email-required' && readinessLabel !== 'Ready') {
    return 'email-required';
  }

  if (hasDraft && ['new', 'reviewed', 'researching', 'email-required', 'outreach-ready', 'drafted'].includes(currentStatus || 'new')) {
    return 'drafted';
  }

  if (readinessLabel === 'Ready') {
    return 'outreach-ready';
  }

  if (readinessLabel === 'Blocked') {
    return 'reviewed';
  }

  return 'researching';
}

function isAutomationTerminalStatus(status = '') {
  return ['contacted', 'replied', 'qualified', 'quoted', 'won', 'lost', 'archived'].includes(status);
}

function buildNextActionDecision({
  channelDecision,
  companyProfile,
  contacts,
  followUpDate,
  permit,
  qualityTier,
  readiness,
  status,
}) {
  const followUpDue = followUpDate && new Date(followUpDate).getTime() <= Date.now();
  const hasPhone = contacts.some((contact) => contact.phone);
  const hasWebsite = Boolean(companyProfile.website);
  const hasForm = contacts.some((contact) => contact.contact_form_url);
  const hasGc = Boolean(getApplicantName(permit));

  if (qualityTier === 'dead') {
    return {
      label: 'Discard / low fit',
      detail: 'Permit relevance is too weak for active outreach right now.',
      queue: 'discard',
      urgency: 'low',
    };
  }

  if (followUpDue || status === 'follow-up-due') {
    return {
      label: 'Follow up today',
      detail: 'A follow-up date is already set, so this lead should move before new research.',
      queue: 'email',
      urgency: 'high',
    };
  }

  if (status === 'contacted' || status === 'replied') {
    return {
      label: 'Monitor reply',
      detail: 'A live touchpoint already exists. Stay on the thread instead of reopening research.',
      queue: 'monitor',
      urgency: 'medium',
    };
  }

  if (channelDecision.primary === 'phone') {
    return {
      label: hasGc ? 'Call GC' : 'Call first',
      detail: channelDecision.reason,
      queue: 'call',
      urgency: readiness.label === 'Ready' ? 'high' : 'medium',
    };
  }

  if (channelDecision.primary === 'email') {
    return {
      label: channelDecision.recipientType === 'guessed' ? 'Review guessed email' : 'Email first',
      detail: channelDecision.reason,
      queue: 'email',
      urgency: readiness.label === 'Ready' ? 'high' : 'medium',
    };
  }

  if (channelDecision.primary === 'form' && hasForm) {
    return {
      label: 'Submit contact form',
      detail: channelDecision.reason,
      queue: 'form',
      urgency: readiness.label === 'Ready' ? 'medium' : 'low',
    };
  }

  if (!hasPhone && hasGc) {
    return {
      label: 'Search GC phone',
      detail: 'The GC is known, but the cleanest direct route is still missing.',
      queue: 'research',
      urgency: 'medium',
    };
  }

  if (!hasWebsite && permit.owner_business_name) {
    return {
      label: 'Find official website',
      detail: 'Resolve the real company site before you trust the rest of the contact layer.',
      queue: 'research',
      urgency: 'medium',
    };
  }

  if (channelDecision.primary === 'linkedin') {
    return {
      label: 'Draft LinkedIn note',
      detail: channelDecision.reason,
      queue: 'dm',
      urgency: 'low',
    };
  }

  return {
    label: 'Research contact route',
    detail: 'The fit may be real, but the clean route still needs work.',
    queue: 'research',
    urgency: 'low',
  };
}

function getBusinessHourState(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NYC_TIME_ZONE,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
    minute: 'numeric',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );

  const weekday = parts.weekday;
  const hour = Number.parseInt(parts.hour || '0', 10);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const insideBusinessHours = !isWeekend && hour >= NYC_BUSINESS_HOURS.startHour && hour < NYC_BUSINESS_HOURS.endHour;

  return { insideBusinessHours, isWeekend, hour, weekday };
}

function pickPrimaryContact(contacts, companyProfile = {}, permit = {}) {
  const trustedEmailContact = pickBestEmailContact(contacts, companyProfile, permit);

  return trustedEmailContact
    || contacts.find((contact) => contact.phone)
    || contacts.find((contact) => contact.contact_form_url)
    || null;
}

function pickBestEmailContact(contacts, companyProfile = {}, permit = {}) {
  const emailContacts = [...contacts]
    .filter((contact) => contact.email)
    .sort((left, right) => {
      return scoreEmailContactForSelection(right, companyProfile, permit) - scoreEmailContactForSelection(left, companyProfile, permit);
    });

  return emailContacts.find((contact) => scoreEmailContactForSelection(contact, companyProfile, permit) > 0) || null;
}

function getAutoSendEmailContacts(contacts, companyProfile = {}, permit = {}) {
  const seen = new Set();

  return [...contacts]
    .filter((contact) => contact.email && contact.type !== 'guessed')
    .map((contact) => ({
      ...contact,
      autoSendScore: scoreEmailContactForSelection(contact, companyProfile, permit),
    }))
    .filter((contact) => contact.autoSendScore >= AUTO_SEND_EMAIL_SCORE_THRESHOLD)
    .sort((left, right) => {
      if (right.autoSendScore !== left.autoSendScore) {
        return right.autoSendScore - left.autoSendScore;
      }

      return Math.round(right.confidence || 0) - Math.round(left.confidence || 0);
    })
    .filter((contact) => {
      const email = normalizeEmailAddress(contact.email);
      if (!email || seen.has(email)) {
        return false;
      }

      seen.add(email);
      return true;
    })
    .slice(0, AUTO_SEND_EMAIL_CONTACT_LIMIT);
}

function getManualSendEmailContacts(contacts, companyProfile = {}, permit = {}) {
  const seen = new Set();
  const scoredContacts = [...contacts]
    .filter((contact) => contact.email)
    .map((contact) => ({
      ...contact,
      manualSendScore: scoreEmailContactForSelection(contact, companyProfile, permit),
    }))
    .filter((contact) => contact.manualSendScore > 0)
    .sort((left, right) => {
      if (right.manualSendScore !== left.manualSendScore) {
        return right.manualSendScore - left.manualSendScore;
      }

      return Math.round(right.confidence || 0) - Math.round(left.confidence || 0);
    })
    .filter((contact) => {
      const email = normalizeEmailAddress(contact.email);
      if (!email || seen.has(email)) {
        return false;
      }

      seen.add(email);
      return true;
    });

  if (scoredContacts.length > 0) {
    return scoredContacts;
  }

  return [...contacts]
    .filter((contact) => {
      const normalizedEmail = normalizeEmailAddress(contact.email || '');
      const domain = emailDomain(normalizedEmail);
      const source = normalizeText(contact.source || '');
      const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));
      const contactWebsiteDomain = normalizeText(rootDomain(contact.website_url || ''));
      const directDomainMatch = Boolean(
        officialDomain && (domain === officialDomain || domain.endsWith(`.${officialDomain}`)),
      );
      const websiteDomainMatch = Boolean(
        officialDomain && contactWebsiteDomain && (
          contactWebsiteDomain === officialDomain
          || contactWebsiteDomain.endsWith(`.${officialDomain}`)
        ),
      );
      const manualSource = source === 'manual';
      const fallbackConfidence = Math.round(contact.confidence || 0);

      if (!normalizedEmail || !domain) {
        return false;
      }

      if (isBlockedEmailDomain(domain) || isPlaceholderMailbox(normalizedEmail) || source === 'pattern_guess') {
        return false;
      }

      if (manualSource || directDomainMatch || websiteDomainMatch || isEntityAlignedEmailContact(contact, companyProfile, permit)) {
        return true;
      }

      if (isFreeMailboxDomain(domain)) {
        return false;
      }

      return fallbackConfidence >= 70 && source !== 'brave_search';
    })
    .map((contact) => ({
      ...contact,
      manualSendScore: Math.max(1, Math.round(contact.confidence || 0)),
    }))
    .sort((left, right) => {
      if (Boolean(right.is_primary) !== Boolean(left.is_primary)) {
        return Boolean(right.is_primary) ? 1 : -1;
      }

      return right.manualSendScore - left.manualSendScore;
    })
    .filter((contact) => {
      const email = normalizeEmailAddress(contact.email);
      if (!email || seen.has(email)) {
        return false;
      }

      seen.add(email);
      return true;
    });
}

function buildDraft(lead, companyProfile, contacts) {
  const primaryContact = pickPrimaryContact(contacts, companyProfile, lead.raw_permit || lead);
  const address = sanitizeOutreachCopy(lead.address);
  const projectAngle = getProjectAngle(lead);
  const relevanceScore = Number(lead.score_breakdown?.relevanceScore || lead.scoreBreakdown?.relevanceScore || 0.3);
  const relevanceKeyword = lead.score_breakdown?.relevanceKeyword || lead.scoreBreakdown?.relevanceKeyword || '';
  const pluginLine = sanitizeOutreachCopy(getPluginLine(`${lead.permit_key}:${lead.score}`));
  const role = getDraftRole(lead, companyProfile, primaryContact);
  const contactName = getDraftRecipientName(primaryContact, companyProfile, lead);
  const introLine = sanitizeOutreachCopy(buildDraftIntro(lead, projectAngle, relevanceKeyword));
  const valueLine = sanitizeOutreachCopy(getDraftValueLine(role, projectAngle));
  const cta = sanitizeOutreachCopy(chooseDraftCta(lead, role, projectAngle, relevanceScore));
  const subject = sanitizeOutreachCopy(`${address} filing`);
  const body = [
    `Hi ${contactName},`,
    '',
    introLine,
    '',
    valueLine,
    '',
    cta,
    '',
    'Best,',
    'Donald',
  ]
    .map((line) => sanitizeOutreachCopy(line))
    .join('\n');

  const callOpener = sanitizeOutreachCopy(
    `Hi, this is Donald from MetroGlass Pro. I came across the filing for ${address} and wanted to reach out. Not sure if you’re the right contact for the project, but we handle storefronts, shower doors, mirrors, railings, and custom glass across NYC. If any of that scope is still open, I’d be happy to help.`,
  );
  const followUpNote = sanitizeOutreachCopy(
    `Following up on the filing for ${address}. If any glass scope is still open, I’d be happy to help.`,
  );

  return {
    subject,
    body,
    pluginLine,
    introLine,
    callOpener,
    followUpNote,
    recipient: primaryContact?.email || '',
    recipientType: primaryContact?.type || '',
    autoChannel: lead.best_channel || 'email',
  };
}

async function upsertDraftRecord(gateway, leadId, patch, existingDraft = null) {
  const currentDraft = existingDraft
    || (
      await gateway.select('outreach', {
        filters: [eq('lead_id', leadId)],
        ordering: [order('created_at', 'desc')],
        pageLimit: 1,
      })
    )[0]
    || null;

  const payload = {
    channel: patch.channel || currentDraft?.channel || 'email',
    recipient: patch.recipient ?? currentDraft?.recipient ?? '',
    recipient_type: patch.recipientType ?? currentDraft?.recipient_type ?? '',
    subject: patch.subject ?? currentDraft?.subject ?? '',
    draft: patch.body ?? currentDraft?.draft ?? '',
    plugin_line: patch.pluginLine ?? currentDraft?.plugin_line ?? '',
    call_opener: patch.callOpener ?? currentDraft?.call_opener ?? '',
    follow_up_note: patch.followUpNote ?? currentDraft?.follow_up_note ?? '',
    status: currentDraft?.status === 'sent' ? 'draft' : patch.status ?? currentDraft?.status ?? 'draft',
    metadata: {
      ...(currentDraft?.metadata || {}),
      ...(patch.metadata || {}),
    },
  };

  if (currentDraft && currentDraft.status !== 'sent') {
    const updated = await gateway.patch('outreach', [eq('id', currentDraft.id)], payload);
    return updated[0] || { ...currentDraft, ...payload };
  }

  const inserted = await gateway.insert('outreach', {
    id: createId('outreach'),
    lead_id: leadId,
    ...payload,
  });

  return inserted[0] || null;
}

function buildDerivedLeadState({
  leadRow,
  companyProfile,
  propertyProfile,
  contacts,
  promoteDrafted = false,
}) {
  const permit = leadRow.raw_permit || {};
  const contactability = buildContactability(permit, propertyProfile, companyProfile, contacts);
  const channelDecision = buildChannelDecision({
    score: leadRow.score,
    contactability,
    companyProfile,
    contacts,
    permit,
  });
  const readiness = buildOutreachReadiness(leadRow.score, contactability, companyProfile, contacts, channelDecision);
  const qualityTier = buildQualityTier({ leadRow, contactability, companyProfile, contacts });
  const { priorityLabel, priorityScore } = buildPriorityState(leadRow.score, contactability, readiness);
  const followUpDate = leadRow.enrichment_summary?.manualEnrichment?.followUpDate || '';
  const status = resolveLeadStatus({
    currentStatus: leadRow.status,
    followUpDate,
    hasDraft: promoteDrafted,
    qualityTier,
    readinessLabel: readiness.label,
  });
  const nextAction = buildNextActionDecision({
    channelDecision,
    companyProfile,
    contacts,
    followUpDate,
    permit,
    qualityTier,
    readiness,
    status,
  });
  const autoSendContacts = getAutoSendEmailContacts(contacts, companyProfile, permit);
  const autoSendEligible =
    AUTO_SEND_ENABLED &&
    autoSendContacts.length > 0 &&
    readiness.label !== 'Blocked' &&
    qualityTier !== 'dead';

  return {
    contactability,
    channelDecision: {
      ...channelDecision,
      autoSendEligible,
    },
    readiness,
    qualityTier,
    priorityLabel,
    priorityScore,
    status,
    nextAction,
    enrichmentConfidence: Math.round(((companyProfile.confidence || 0) * 0.45) + ((propertyProfile.confidence || 0) * 0.3) + (readiness.score * 0.25)),
    autoSendEligible,
    autoSendReason: qualityTier === 'dead'
      ? 'Permit relevance is too weak for active outreach.'
      : AUTO_SEND_ENABLED
      ? autoSendEligible
        ? `${autoSendContacts.length} strong email route${autoSendContacts.length > 1 ? 's are' : ' is'} ready for automatic sending.`
        : 'No strong email route has cleared the automatic send threshold yet.'
      : 'Auto-send is disabled until resolver trust is stronger.',
  };
}

function permitLikeName(value) {
  if (!value) {
    return '';
  }
  return value.split(' ')[0].replace(/[,;]/g, '').trim() || value;
}

function buildLeadRow(permit, scoreBreakdown) {
  const address = getPermitAddress(permit);
  const estimatedCost = parseAmount(permit.estimated_job_costs);

  return {
    permit_key: getPermitKey(permit),
    address,
    normalized_address: address.toUpperCase(),
    borough: permit.borough || '',
    description: permit.job_description || '',
    score: scoreBreakdown.total,
    status: 'new',
    lead_tier: scoreBreakdown.relevanceScore >= 0.8 ? 'hot' : scoreBreakdown.relevanceScore >= 0.5 ? 'warm' : 'cold',
    priority_label: 'Monitor',
    priority_score: 0,
    contactability_score: 0,
    contactability_label: 'Weak',
    outreach_readiness_score: 0,
    outreach_readiness_label: 'Needs Review',
    linkedin_worthy: false,
    best_channel: 'email',
    best_next_action: {},
    score_breakdown: scoreBreakdown,
    contactability_breakdown: {},
    enrichment_summary: {
      qualityTier: scoreBreakdown.relevanceScore < MIN_RELEVANCE_THRESHOLD ? 'dead' : scoreBreakdown.relevanceScore >= 0.8 ? 'hot' : scoreBreakdown.relevanceScore >= 0.5 ? 'warm' : 'cold',
    },
    raw_permit: permit,
    project_tags: buildProjectTags(permit),
    work_type: permit.work_type || '',
    filing_reason: permit.filing_reason || '',
    issued_date: permit.issued_date || null,
    approved_date: permit.approved_date || null,
    expiry_date: permit.expired_date || null,
    estimated_cost: estimatedCost,
    owner_name: permit.owner_name || '',
    owner_business_name: permit.owner_business_name || '',
    applicant_name: getApplicantName(permit),
    applicant_business_name: permit.applicant_business_name || '',
    filing_rep_name: getFilingRepName(permit),
    company_match_strength: 'weak',
    last_scanned_at: new Date().toISOString(),
  };
}

function getIssuedAtValue(leadRow) {
  const value = leadRow.issued_date ? new Date(leadRow.issued_date).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function getDescriptionStrength(leadRow) {
  return (leadRow.description || '').trim().length;
}

function mergeRawPermit(existingPermit = {}, nextPermit = {}) {
  return {
    ...existingPermit,
    ...Object.fromEntries(Object.entries(nextPermit).filter(([, value]) => value !== '' && value !== null && value !== undefined)),
  };
}

function mergeLeadRows(existingRow, nextRow) {
  const nextWins =
    nextRow.score > existingRow.score
      || (nextRow.score === existingRow.score && getIssuedAtValue(nextRow) > getIssuedAtValue(existingRow))
      || (nextRow.score === existingRow.score && getIssuedAtValue(nextRow) === getIssuedAtValue(existingRow) && getDescriptionStrength(nextRow) > getDescriptionStrength(existingRow));

  const preferred = nextWins ? nextRow : existingRow;
  const secondary = nextWins ? existingRow : nextRow;

  return {
    ...secondary,
    ...preferred,
    raw_permit: mergeRawPermit(secondary.raw_permit, preferred.raw_permit),
    project_tags: Array.from(new Set([...(secondary.project_tags || []), ...(preferred.project_tags || [])])),
    owner_name: preferred.owner_name || secondary.owner_name || '',
    owner_business_name: preferred.owner_business_name || secondary.owner_business_name || '',
    applicant_name: preferred.applicant_name || secondary.applicant_name || '',
    applicant_business_name: preferred.applicant_business_name || secondary.applicant_business_name || '',
    filing_rep_name: preferred.filing_rep_name || secondary.filing_rep_name || '',
    description: preferred.description || secondary.description || '',
  };
}

function dedupeLeadRows(leadRows) {
  const byPermitKey = new Map();
  let droppedWithoutKey = 0;

  leadRows.forEach((leadRow) => {
    if (!leadRow.permit_key) {
      droppedWithoutKey += 1;
      return;
    }

    const existing = byPermitKey.get(leadRow.permit_key);
    byPermitKey.set(
      leadRow.permit_key,
      existing ? mergeLeadRows(existing, leadRow) : leadRow,
    );
  });

  return {
    rows: Array.from(byPermitKey.values()),
    duplicatesCollapsed: Math.max(leadRows.length - byPermitKey.size - droppedWithoutKey, 0),
    droppedWithoutKey,
  };
}

function buildProjectTags(permit) {
  const description = normalizeText(permit.job_description);
  const tags = [];

  if (description.includes('shower') || description.includes('bathroom')) tags.push('shower');
  if (description.includes('mirror')) tags.push('mirror');
  if (description.includes('storefront') || description.includes('retail')) tags.push('storefront');
  if (description.includes('partition') || description.includes('office')) tags.push('partitions');
  if (description.includes('retail') || description.includes('commercial')) tags.push('commercial');
  if (description.includes('renovation') || description.includes('alteration')) tags.push('renovation');

  return uniq(tags);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchDobPermits() {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - DEFAULT_SCAN_WINDOW_DAYS);
  const dateString = `${dateFrom.toISOString().split('T')[0]}T00:00:00`;
  const boroughFilter = [...METROGLASS_PROFILE.primaryBoroughs, ...METROGLASS_PROFILE.secondaryBoroughs]
    .map((borough) => `borough='${borough}'`)
    .join(' OR ');
  const workTypeFilter = METROGLASS_PROFILE.workTypes.map((workType) => `work_type='${workType}'`).join(' OR ');
  const where = [
    `issued_date>'${dateString}'`,
    `estimated_job_costs>'${METROGLASS_PROFILE.minCost}'`,
    `permit_status='Permit Issued'`,
    `filing_reason='Initial Permit'`,
    `(${boroughFilter})`,
    `(${workTypeFilter})`,
  ].join(' AND ');

  const url = `${API_ENDPOINTS.permits}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=${DEFAULT_SCAN_LIMIT}`;
  return fetchJson(url);
}

async function geocodeAddress(env, address) {
  if (!env.GOOGLE_MAPS_API_KEY || !address) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      address,
      key: env.GOOGLE_MAPS_API_KEY,
      region: 'us',
    });
    const payload = await fetchJson(`${API_ENDPOINTS.googleGeocode}?${params.toString()}`);
    const result = payload.results?.[0];
    if (!result) {
      return null;
    }

    const neighborhood = result.address_components?.find((component) => component.types?.includes('neighborhood'))?.long_name
      || result.address_components?.find((component) => component.types?.includes('sublocality_level_1'))?.long_name
      || '';

    return {
      place_id: result.place_id,
      formatted_address: result.formatted_address,
      neighborhood,
      confidence: result.geometry?.location_type === 'ROOFTOP' ? 92 : 74,
      maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    };
  } catch {
    return null;
  }
}

async function fetchPlutoProfile(permit) {
  if (!permit.bbl) {
    return null;
  }

  try {
    const query = new URLSearchParams({
      bbl: permit.bbl,
      $limit: '1',
    });
    const rows = await fetchJson(`${API_ENDPOINTS.pluto}?${query.toString()}`);
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function fetchHpdSummary(permit) {
  const bin = permit.bin;
  if (!bin) {
    return null;
  }

  try {
    const query = new URLSearchParams({
      bin,
      $select: 'count(*) as count',
      $limit: '1',
    });
    const rows = await fetchJson(`${API_ENDPOINTS.hpdViolations}?${query.toString()}`);
    return {
      count: Number.parseInt(rows?.[0]?.count || '0', 10) || 0,
    };
  } catch {
    return null;
  }
}

function buildAcrisSummary(permit) {
  const boroughMap = {
    MANHATTAN: 1,
    BRONX: 2,
    BROOKLYN: 3,
    QUEENS: 4,
    'STATEN ISLAND': 5,
  };

  return {
    available: Boolean(permit.block && permit.lot),
    url:
      permit.block && permit.lot && permit.borough
        ? `https://a836-acris.nyc.gov/CP/LookUp/Index?b=${boroughMap[permit.borough] || ''}&f=${permit.block}&l=${permit.lot}`
        : '',
  };
}

async function searchCompanyDomain(env, permit, leadScore, options = {}) {
  const companySeeds = [
    { name: permit.applicant_business_name, role: 'applicant', context: 'contractor' },
    { name: permit.owner_business_name, role: 'owner', context: 'company' },
    { name: permit.filing_representative_business_name, role: 'filing_rep', context: 'architect' },
    { name: getApplicantName(permit), role: 'applicant', context: 'contractor' },
    { name: getFilingRepName(permit), role: 'filing_rep', context: 'architect' },
  ]
    .filter((entry) => entry.name)
    .filter((entry, index, all) => all.findIndex((candidate) => normalizeText(candidate.name) === normalizeText(entry.name)) === index)
    .slice(0, 3);

  const fallbackSeed = companySeeds[0];
  if (!env.BRAVE_API_KEY || !fallbackSeed) {
    return {
      company_name: fallbackSeed?.name || '',
      normalized_name: normalizeText(fallbackSeed?.name || ''),
      role: fallbackSeed?.role || 'owner',
      website: '',
      domain: '',
      confidence: 0,
      description: '',
      search_query: fallbackSeed?.name || '',
      search_results: [],
      social_links: {},
      candidates: [],
      match_strength: 'weak',
    };
  }

  try {
    const searchPlans = companySeeds.flatMap((seed) =>
      uniq([
        `${seed.name} NYC ${seed.context}`,
        `${seed.name} official website`,
        options.force ? `${seed.name} contact email phone` : '',
      ])
        .filter(Boolean)
        .map((query) => ({ seed, query })),
    );

    const resultSets = await Promise.all(searchPlans.map(async (plan) => ({
      ...plan,
      results: await runBraveSearch(env, plan.query),
    })));

    const allResults = [];
    const scoredCandidates = [];

    resultSets.forEach((plan) => {
      plan.results.forEach((result) => {
        const mappedResult = {
          title: result.title || '',
          url: result.url || '',
          description: result.description || '',
        };
        allResults.push(mappedResult);

        const candidateScore = scoreWebsiteCandidate(mappedResult, plan.seed, permit);
        if (candidateScore > 0) {
          scoredCandidates.push({
            seed: plan.seed,
            query: plan.query,
            result: mappedResult,
            score: candidateScore,
          });
        }
      });
    });

    scoredCandidates.sort((left, right) => right.score - left.score);

    const candidateByUrl = new Map();
    scoredCandidates.forEach((candidate) => {
      const url = originFromUrl(candidate.result.url) || candidate.result.url || '';
      if (!url) {
        return;
      }

      const existing = candidateByUrl.get(url);
      if (!existing || candidate.score > existing.score) {
        candidateByUrl.set(url, {
          ...candidate,
          url,
        });
      }
    });

    const rankedCandidates = [...candidateByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, options.force ? 6 : 4);

    const winningCandidate = rankedCandidates[0] || null;
    const searchSignals = extractSearchSignals(allResults);
    const website = winningCandidate ? originFromUrl(winningCandidate.result.url) : searchSignals.website || '';
    const domain = rootDomain(website);
    const confidence = winningCandidate ? clamp(winningCandidate.score, 18, 96) : 18;

    return {
      company_name: winningCandidate?.seed.name || fallbackSeed.name,
      normalized_name: normalizeText(winningCandidate?.seed.name || fallbackSeed.name),
      role: winningCandidate?.seed.role || fallbackSeed.role,
      website,
      domain,
      confidence,
      description: winningCandidate?.result.description || '',
      search_query: searchPlans.map((plan) => plan.query).join(' | '),
      search_results: mapSearchResults(allResults),
      social_links: {
        linkedin_url: searchSignals.linkedin_url || '',
        instagram_url: searchSignals.instagram_url || '',
        contact_form_url: searchSignals.contact_form_url || '',
      },
      candidates: rankedCandidates.map((candidate, index) =>
        buildResolutionCandidate({
          type: 'company',
          role: candidate.seed.role || fallbackSeed.role,
          label: candidate.seed.name || candidate.result.title || candidate.url,
          url: candidate.url,
          domain: rootDomain(candidate.url),
          source: 'brave_search',
          confidence: clamp(candidate.score, 18, 96),
          status: index === 0 ? 'selected' : 'rejected',
          detail: candidate.result.description || candidate.result.title || '',
          matchedQuery: candidate.query,
        }),
      ),
      linked_in_url: searchSignals.linkedin_url || '',
      instagram_url: searchSignals.instagram_url || '',
      match_strength: confidence >= 76 ? 'strong' : confidence >= 52 ? 'medium' : 'weak',
    };
  } catch {
    return {
      company_name: fallbackSeed.name,
      normalized_name: normalizeText(fallbackSeed.name),
      role: fallbackSeed.role,
      website: '',
      domain: '',
      confidence: 20,
      description: '',
      search_query: fallbackSeed.name,
      search_results: [],
      social_links: {},
      candidates: [],
      linked_in_url: '',
      instagram_url: '',
      match_strength: 'weak',
    };
  }
}

function isDirectoryResult(result) {
  const domain = rootDomain(result.url || '');
  const title = normalizeText(result.title || '');
  return (
    !domain ||
    isDirectoryDomain(domain) ||
    title.includes(' on yelp') ||
    title.includes(' on houzz') ||
    title.includes(' on angi') ||
    title.includes('yellow pages')
  );
}

function scoreWebsiteCandidate(result, seed, permit) {
  const domain = rootDomain(result.url || '');
  if (!domain || isDirectoryResult(result)) {
    return -100;
  }

  const normalizedSeed = stripCompanySuffix(seed.name);
  const seedTokens = tokenizeName(seed.name);
  const title = stripCompanySuffix(result.title || '');
  const description = stripCompanySuffix(result.description || '');
  const normalizedDomain = stripCompanySuffix(domain.replace(/[.-]/g, ' '));
  const searchable = `${title} ${description} ${domain}`;
  const permitContext = stripCompanySuffix([
    permit.borough,
    permit.job_description,
    permit.work_type,
    permit.filing_reason,
  ].join(' '));

  let score = 15;
  const tokenMatches = countTokenMatches(seedTokens, searchable);
  const domainTokenMatches = countTokenMatches(seedTokens, normalizedDomain);
  score += tokenMatches * 12;
  score += domainTokenMatches * 14;

  if (normalizedSeed && searchable.includes(normalizedSeed)) {
    score += 26;
  }

  if (title.includes(normalizedSeed)) {
    score += 20;
  }

  if (domainTokenMatches === 0) {
    score -= 24;
  } else {
    score += 10;
  }

  if (result.url?.includes('/contact') || result.url?.includes('/about') || result.url?.includes('/team')) {
    score += 8;
  }

  if (seed.context === 'contractor' && searchable.includes('contractor')) {
    score += 12;
  }

  if (seed.context === 'architect' && (searchable.includes('architect') || searchable.includes('design'))) {
    score += 12;
  }

  if (permitContext.includes('glass') && searchable.includes('glass')) {
    score += 8;
  }

  if (permitContext.includes('storefront') && (searchable.includes('storefront') || searchable.includes('facade'))) {
    score += 8;
  }

  if (permitContext.includes('partition') && searchable.includes('partition')) {
    score += 6;
  }

  if (searchable.includes('nyc') || searchable.includes('new york') || searchable.includes(normalizeText(permit.borough || ''))) {
    score += 6;
  }

  if (domain.split('.').length <= 3) {
    score += 4;
  }

  return score;
}

function extractEmails(text) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniq(matches.map((entry) => entry.toLowerCase()));
}

function extractPhones(text) {
  const matches = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g) || [];
  return uniq(matches.map((entry) => entry.trim()));
}

function extractLinks(markdown) {
  const links = [];
  const regex = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  let match = regex.exec(markdown);
  while (match) {
    links.push(match[1]);
    match = regex.exec(markdown);
  }
  return uniq(links);
}

function mapSearchResults(results) {
  return results.map((result) => ({
    title: result.title || '',
    url: result.url || '',
    description: result.description || '',
  }));
}

function buildResolutionCandidate({
  confidence,
  detail = '',
  domain = '',
  label = '',
  matchedQuery = '',
  role = '',
  source = '',
  status = 'candidate',
  type,
  url = '',
}) {
  return {
    id: createId('candidate'),
    candidate_type: type,
    role,
    label,
    url,
    domain,
    source,
    confidence,
    status,
    metadata: {
      detail,
      matchedQuery,
    },
  };
}

function isSkippableSearchDomain(url) {
  const domain = rootDomain(url || '');
  return (
    !domain ||
    domain.includes('linkedin.com') ||
    domain.includes('instagram.com') ||
    domain.includes('facebook.com') ||
    isDirectoryDomain(domain)
  );
}

function extractSearchSignals(searchResults = []) {
  const urls = searchResults.map((result) => result.url).filter(Boolean);
  const textBlob = searchResults
    .map((result) => [result.title, result.description].filter(Boolean).join(' '))
    .join('\n');

  return {
    website: urls.find((url) => !isSkippableSearchDomain(url)) || '',
    linkedin_url: urls.find((url) => url.includes('linkedin.com')) || '',
    instagram_url: urls.find((url) => url.includes('instagram.com')) || '',
    contact_form_url:
      urls.find((url) => normalizeText(url).includes('/contact')) ||
      urls.find((url) => normalizeText(url).includes('contact-us')) ||
      '',
    emails: extractEmails(textBlob),
    phones: extractPhones(textBlob),
  };
}

async function runBraveSearch(env, query) {
  const url = `${API_ENDPOINTS.braveSearch}?${new URLSearchParams({ q: query, count: '5' }).toString()}`;
  const payload = await fetchJson(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': env.BRAVE_API_KEY,
    },
  });

  return payload.web?.results || [];
}

function scorePersonCandidate(personName, companyName, result) {
  const fullName = stripCompanySuffix(personName);
  const fullNameTokens = tokenizeName(personName);
  const companyTokens = tokenizeName(companyName || '');
  const title = stripCompanySuffix(result.title || '');
  const description = stripCompanySuffix(result.description || '');
  const searchable = `${title} ${description} ${result.url || ''}`;

  let score = 20;
  const personMatches = countTokenMatches(fullNameTokens, searchable);
  score += personMatches * 12;

  if (fullName && searchable.includes(fullName)) {
    score += 28;
  }

  if (result.url?.includes('linkedin.com/in')) {
    score += 18;
  }

  if (companyTokens.length > 0) {
    score += countTokenMatches(companyTokens, searchable) * 8;
  }

  if (searchable.includes('nyc') || searchable.includes('new york')) {
    score += 4;
  }

  return score;
}

async function resolvePersonSignals(env, permit, companyProfile, options = {}) {
  if (!env.BRAVE_API_KEY) {
    return [];
  }

  const companyName =
    companyProfile.company_name ||
    permit.applicant_business_name ||
    permit.filing_representative_business_name ||
    permit.owner_business_name ||
    '';

  const people = [
    { name: getApplicantName(permit), role: 'applicant' },
    { name: getFilingRepName(permit), role: 'filing rep' },
  ]
    .filter((entry) => entry.name)
    .filter((entry, index, all) => all.findIndex((candidate) => normalizeText(candidate.name) === normalizeText(entry.name)) === index)
    .slice(0, options.force ? 2 : 1);

  if (people.length === 0) {
    return [];
  }

  const searches = await Promise.all(
    people.map(async (person) => {
      const queries = uniq([
        `site:linkedin.com/in "${person.name}" ${companyName} NYC`,
        options.force ? `"${person.name}" ${companyName} NYC` : '',
      ]).filter(Boolean);

      const resultSets = await Promise.all(queries.map((query) => runBraveSearch(env, query)));
      const results = mapSearchResults(resultSets.flat());
      const scored = results
        .map((result) => ({
          result,
          score: scorePersonCandidate(person.name, companyName, result),
        }))
        .filter((candidate) => candidate.score > 24)
        .sort((left, right) => right.score - left.score);

      const linkedin = scored.find((candidate) => candidate.result.url.includes('linkedin.com/in'))?.result.url || '';
      const organizationPage = scored.find((candidate) => !isDirectoryResult(candidate.result))?.result.url || '';
      const organizationName =
        scored[0]?.result.title?.split('|')[0]?.trim() ||
        scored[0]?.result.title?.split('-')[0]?.trim() ||
        companyName;

      return {
        ...person,
        linkedin_url: linkedin,
        organization_url: organizationPage ? originFromUrl(organizationPage) : '',
        organization_name: organizationName || companyName,
        confidence: clamp(scored[0]?.score || 0, 0, 92),
        candidates: scored.slice(0, options.force ? 5 : 3).map((candidate, index) =>
          buildResolutionCandidate({
            type: 'person',
            role: person.role,
            label: candidate.result.title || person.name,
            url: candidate.result.url || '',
            domain: rootDomain(candidate.result.url || ''),
            source: 'brave_person_search',
            confidence: clamp(candidate.score, 18, 92),
            status: index === 0 ? 'selected' : 'rejected',
            detail: candidate.result.description || '',
            matchedQuery: queries.join(' | '),
          }),
        ),
      };
    }),
  );

  return searches.filter((entry) => entry.linkedin_url || entry.organization_url);
}

async function scrapeWebsiteSignals(env, leadScore, website, options = {}) {
  if (!env.FIRECRAWL_API_KEY || !website || (!options.force && leadScore < HIGH_VALUE_SCORE)) {
    return null;
  }

  const urls = uniq([
    website,
    website.replace(/\/$/, '') + '/contact',
    website.replace(/\/$/, '') + '/about',
  ]).slice(0, 3);

  try {
    const pages = await Promise.all(
      urls.map(async (url) => {
        const response = await fetch(API_ENDPOINTS.firecrawlScrape, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            onlyMainContent: true,
            formats: ['markdown'],
          }),
        });

        if (!response.ok) {
          return null;
        }

        const payload = await response.json();
        return payload?.data?.markdown || '';
      }),
    );

    const combined = pages.filter(Boolean).join('\n');
    if (!combined) {
      return null;
    }

    const links = extractLinks(combined);
    const socialLinks = {
      linkedin_url: links.find((entry) => entry.includes('linkedin.com')) || '',
      instagram_url: links.find((entry) => entry.includes('instagram.com')) || '',
      contact_form_url:
        links.find((entry) => normalizeText(entry).includes('contact')) ||
        links.find((entry) => normalizeText(entry).includes('forms')),
    };

    return {
      emails: extractEmails(combined),
      phones: extractPhones(combined),
      socialLinks,
      serviceText: combined.slice(0, 1400),
    };
  } catch {
    return null;
  }
}

function generateGuessedEmails(companyProfile, permit, contacts) {
  const domain = normalizeText(companyProfile.domain || '');
  if (!domain || isDirectoryDomain(domain) || isFreeMailboxDomain(domain)) {
    return [];
  }

  if ((companyProfile.match_strength || 'weak') !== 'strong') {
    return [];
  }

  const nameSeed = getApplicantName(permit) || getFilingRepName(permit) || permit.owner_name || '';
  const parts = nameSeed
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((part) => part.length >= 2);

  if (parts.length < 2) {
    return [];
  }

  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  const patterns = uniq([
    parts.length >= 2 ? `${first}` : '',
    parts.length >= 2 ? `${first}.${last}` : '',
    parts.length >= 2 ? `${first[0]}${last}` : '',
  ]
    .filter(Boolean)
    .map((localPart) => `${localPart}@${domain}`));

  const existing = new Set(contacts.map((contact) => contact.email).filter(Boolean));
  return patterns.filter((entry) => !existing.has(entry));
}

async function maybeVerifyEmail(env, email, shouldVerify) {
  if (!ZEROBOUNCE_ENABLED || !env.ZEROBOUNCE_API_KEY || !email || !shouldVerify) {
    return { verified: false, confidence: shouldVerify ? 68 : 52, status: 'skipped' };
  }

  try {
    const params = new URLSearchParams({
      api_key: env.ZEROBOUNCE_API_KEY,
      email,
      ip_address: '',
    });
    const payload = await fetchJson(`${API_ENDPOINTS.zerobounceValidate}?${params.toString()}`);
    const status = payload.status || 'unknown';
    return {
      verified: status === 'valid',
      confidence: status === 'valid' ? 92 : status === 'catch-all' ? 62 : 24,
      status,
    };
  } catch {
    return { verified: false, confidence: 48, status: 'error' };
  }
}

function dedupeContacts(contacts) {
  const seen = new Set();
  const deduped = [];

  contacts.forEach((contact) => {
    const key = [contact.email, contact.phone, contact.contact_form_url, contact.website_url].filter(Boolean).join('|');
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(contact);
  });

  return deduped;
}

async function enrichLead(env, gateway, leadRow, options = {}) {
  const permit = leadRow.raw_permit || {};
  const [geo, pluto, hpd, companySearch] = await Promise.all([
    geocodeAddress(env, leadRow.address),
    fetchPlutoProfile(permit),
    fetchHpdSummary(permit),
    searchCompanyDomain(env, permit, leadRow.score, options),
  ]);
  const { candidates: companyCandidates = [], ...company } = companySearch;
  const searchSignals = extractSearchSignals(company.search_results || []);

  const propertyProfile = {
    bin: permit.bin || '',
    bbl: permit.bbl || '',
    block: permit.block || '',
    lot: permit.lot || '',
    building_type: pluto?.bldgclass || pluto?.building_class || '',
    property_class: pluto?.landuse || pluto?.owner_type || '',
    neighborhood: geo?.neighborhood || permit.nta || '',
    community_district: permit.community_board || '',
    place_id: geo?.place_id || '',
    maps_url: geo?.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(leadRow.address)}`,
    hpd_summary: hpd || {},
    pluto_payload: pluto || {},
    acris_payload: buildAcrisSummary(permit),
    confidence: Math.round(((geo?.confidence || 0) * 0.55) + (pluto ? 28 : 0) + (hpd ? 12 : 0)),
  };

  const websiteSignals = await scrapeWebsiteSignals(
    env,
    leadRow.score,
    company.website || searchSignals.website,
    options,
  );
  const personSignals = await resolvePersonSignals(env, permit, company, options);
  const resolutionCandidates = [...companyCandidates];
  const contacts = [];
  const facts = [];
  const socialLinks = {
    linkedin_url: company.linked_in_url || searchSignals.linkedin_url || websiteSignals?.socialLinks?.linkedin_url || '',
    instagram_url: company.instagram_url || searchSignals.instagram_url || websiteSignals?.socialLinks?.instagram_url || '',
    contact_form_url:
      company.social_links?.contact_form_url ||
      searchSignals.contact_form_url ||
      websiteSignals?.socialLinks?.contact_form_url ||
      '',
  };

  if (company.website || searchSignals.website) {
    facts.push({
      id: createId('fact'),
      field: 'company_website',
      value: company.website || searchSignals.website,
      source: 'brave_search',
      confidence: company.confidence,
      metadata: {},
    });
  }

  if (socialLinks.linkedin_url) {
    facts.push({
      id: createId('fact'),
      field: 'linkedin_profile',
      value: socialLinks.linkedin_url,
      source: 'brave_search',
      confidence: Math.max(company.confidence - 5, 52),
      metadata: {},
    });
  }

  if (socialLinks.instagram_url) {
    facts.push({
      id: createId('fact'),
      field: 'instagram_profile',
      value: socialLinks.instagram_url,
      source: 'brave_search',
      confidence: Math.max(company.confidence - 10, 45),
      metadata: {},
    });
  }

  if (websiteSignals?.serviceText) {
    facts.push({
      id: createId('fact'),
      field: 'service_description',
      value: websiteSignals.serviceText.slice(0, 280),
      source: 'firecrawl',
      confidence: 82,
      metadata: {},
    });
  }

  personSignals.forEach((person) => {
    if (Array.isArray(person.candidates) && person.candidates.length > 0) {
      resolutionCandidates.push(...person.candidates);
    }

    if (person.linkedin_url) {
      facts.push({
        id: createId('fact'),
        field: `${normalizeText(person.role).replace(/\s+/g, '_')}_linkedin`,
        value: person.linkedin_url,
        source: 'brave_person_search',
        confidence: person.confidence,
        metadata: {},
      });
    }

    if (person.organization_name) {
      facts.push({
        id: createId('fact'),
        field: `${normalizeText(person.role).replace(/\s+/g, '_')}_organization`,
        value: person.organization_name,
        source: 'brave_person_search',
        confidence: Math.max(person.confidence - 6, 42),
        metadata: {},
      });
    }

    contacts.push({
      id: createId('contact'),
      name: person.name,
      role: person.role,
      email: '',
      phone: '',
      website_url: person.organization_url || company.website || searchSignals.website || '',
      linkedin_url: person.linkedin_url || '',
      instagram_url: '',
      contact_form_url: '',
      type: 'public',
      confidence: person.confidence,
      source: 'person_search',
      verified: false,
      is_primary: false,
    });
  });

  searchSignals.phones.forEach((phone, index) => {
    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || getApplicantName(permit) || '',
      role: company.role || 'owner',
      email: '',
      phone,
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: 62,
      source: 'brave_search',
      verified: false,
      is_primary: index === 0 && !contacts.some((contact) => contact.email),
    });
  });

  (websiteSignals?.emails || []).forEach((email, index) => {
    const assessment = assessEmailCandidate(email, {
      companyProfile: company,
      permit,
      source: 'firecrawl',
    });

    if (!assessment.accept) {
      return;
    }

    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || getApplicantName(permit) || '',
      role: company.role || 'owner',
      email: normalizeEmailAddress(email),
      phone: '',
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: assessment.confidence,
      source: 'firecrawl',
      verified: false,
      is_primary: index === 0,
    });
  });

  (websiteSignals?.phones || []).forEach((phone, index) => {
    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || '',
      role: company.role || 'owner',
      email: '',
      phone,
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: 70,
      source: 'firecrawl',
      verified: false,
      is_primary: index === 0 && !websiteSignals?.emails?.length,
    });
  });

  const guessedEmails = generateGuessedEmails(company, permit, contacts);
  guessedEmails.forEach((email, index) => {
    const assessment = assessEmailCandidate(email, {
      companyProfile: company,
      permit,
      source: 'pattern_guess',
    });

    if (!assessment.accept) {
      return;
    }

    contacts.push({
      id: createId('contact'),
      name: getApplicantName(permit) || getFilingRepName(permit) || permit.owner_name || '',
      role: company.role || 'owner',
      email: normalizeEmailAddress(email),
      phone: '',
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'guessed',
      confidence: assessment.confidence,
      source: 'pattern_guess',
      verified: false,
      is_primary: !contacts.some((contact) => contact.email) && index === 0,
    });
  });

  if ((company.website || searchSignals.website) && !contacts.some((contact) => contact.website_url)) {
    contacts.push({
      id: createId('contact'),
      name: '',
      role: company.role || 'owner',
      email: '',
      phone: '',
      website_url: company.website || searchSignals.website,
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: 55,
      source: 'website_resolution',
      verified: false,
      is_primary: false,
    });
  }

  const dedupedContacts = dedupeContacts(contacts);
  const primaryContact = pickPrimaryContact(dedupedContacts, company, leadRow.raw_permit || leadRow) || null;
  dedupedContacts.forEach((contact) => {
    contact.is_primary = Boolean(primaryContact && contact.id === primaryContact.id);
  });

  const primaryEmailCandidate = primaryContact?.email || '';
  const shouldVerify =
    Boolean(primaryEmailCandidate) &&
    (leadRow.score >= HIGH_VALUE_SCORE || options.force);
  const verification = await maybeVerifyEmail(env, primaryEmailCandidate, shouldVerify);

  if (verification.verified && primaryEmailCandidate) {
    const primaryEmailContact = dedupedContacts.find((contact) => contact.email === primaryEmailCandidate);
    if (primaryEmailContact) {
      primaryEmailContact.verified = true;
      primaryEmailContact.confidence = Math.max(primaryEmailContact.confidence, verification.confidence);
    }
  }

  const derivedState = buildDerivedLeadState({
    leadRow,
    companyProfile: company,
    propertyProfile,
    contacts: dedupedContacts,
  });
  const draft = buildDraft({ ...leadRow, best_channel: derivedState.channelDecision.primary }, company, dedupedContacts);

  const nowIso = new Date().toISOString();
  const enrichedLead = {
    ...leadRow,
    lead_tier: derivedState.qualityTier === 'dead' ? 'cold' : derivedState.qualityTier,
    priority_label: derivedState.priorityLabel,
    priority_score: derivedState.priorityScore,
    status: derivedState.status,
    contactability_score: derivedState.contactability.total,
    contactability_label: derivedState.contactability.label,
    outreach_readiness_score: derivedState.readiness.score,
    outreach_readiness_label: derivedState.readiness.label,
    linkedin_worthy: derivedState.channelDecision.primary === 'linkedin',
    best_channel: derivedState.channelDecision.primary,
    best_next_action: derivedState.nextAction,
    contactability_breakdown: derivedState.contactability,
    enrichment_summary: {
      company,
      property: propertyProfile,
      readiness: derivedState.readiness,
      channelDecision: derivedState.channelDecision,
      draft,
      verification,
      qualityTier: derivedState.qualityTier,
    },
    company_match_strength: company.match_strength,
    company_domain: company.domain,
    property_confidence: propertyProfile.confidence,
    enrichment_confidence: derivedState.enrichmentConfidence,
    auto_send_eligible: derivedState.autoSendEligible && Boolean(primaryEmailCandidate || draft.recipient),
    auto_send_reason: derivedState.autoSendReason,
    last_enriched_at: nowIso,
  };

  const leadId = leadRow.id;
  await Promise.all([
    gateway.upsert('property_profiles', [{ ...propertyProfile, lead_id: leadId }], 'lead_id'),
    gateway.upsert('company_profiles', [{ ...company, lead_id: leadId }], 'lead_id'),
    gateway.replaceContacts(leadId, dedupedContacts),
    gateway.replaceFacts(leadId, facts),
    gateway.replaceResolutionCandidates(leadId, resolutionCandidates),
    gateway.patch('leads', [eq('id', leadId)], enrichedLead),
    gateway.insert('activity_log', {
      id: createId('activity'),
      lead_id: leadId,
      event_type: 'lead_enriched',
      summary: 'Lead enrichment completed',
      detail: derivedState.channelDecision.reason,
      metadata: {
        companyConfidence: company.confidence,
        propertyConfidence: propertyProfile.confidence,
        readiness: derivedState.readiness.label,
      },
    }),
  ]);

  const outreachDraftRecord = await upsertDraftRecord(gateway, leadId, {
    channel: derivedState.channelDecision.primary,
    recipient: draft.recipient || '',
    recipientType: draft.recipientType || derivedState.channelDecision.primary,
    subject: draft.subject,
    body: draft.body,
    pluginLine: draft.pluginLine,
    callOpener: draft.callOpener,
    followUpNote: draft.followUpNote,
    status: enrichedLead.auto_send_eligible ? 'queued' : 'draft',
    metadata: {
      introLine: draft.introLine,
      companyWebsite: company.website,
      alternatives: derivedState.channelDecision.alternatives,
    },
  });

  return {
    lead: enrichedLead,
    propertyProfile,
    companyProfile: company,
    contacts: dedupedContacts,
    facts,
    outreachDraft: outreachDraftRecord,
  };
}

async function maybeAutoSend(env, gateway, enriched) {
  const { lead, contacts, outreachDraft } = enriched;
  if (!lead.auto_send_eligible || !hasGmailAutomation(env)) {
    return { sent: false, reason: lead.auto_send_reason || 'Auto-send disabled' };
  }

  const now = new Date();
  const sendLimits = getAutoSendLimits(now);
  const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
  const lastHour = new Date(now.getTime() - (60 * 60 * 1000)).toISOString();
  const [sentToday, sentThisHour] = await Promise.all([
    gateway.countSentSince(last24Hours),
    gateway.countSentSince(lastHour),
  ]);

  if (sentToday >= sendLimits.perDay || sentThisHour >= sendLimits.perHour) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: `Queued, but send throttle limit reached for this warm-up window (${sendLimits.perDay}/day, ${sendLimits.perHour}/hour).`,
    });
    return { sent: false, reason: 'Throttle limit reached' };
  }

  const emailContacts = getAutoSendEmailContacts(contacts, lead.enrichment_summary?.company || {}, lead);
  if (emailContacts.length === 0) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'No strong email route is available for auto-send.',
      status: 'needs review',
    });
    return { sent: false, reason: 'No email contact' };
  }

  const duplicateSince = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  let sentCount = 0;
  const sentRecipients = [];
  const skippedRecipients = [];

  for (const [index, contact] of emailContacts.entries()) {
    if ((sentToday + sentCount) >= sendLimits.perDay || (sentThisHour + sentCount) >= sendLimits.perHour) {
      skippedRecipients.push({
        recipient: contact.email,
        reason: 'Throttle limit reached',
      });
      break;
    }

    const isDuplicate = await gateway.hasDuplicateOutreach(contact.email, duplicateSince);
    if (isDuplicate) {
      skippedRecipients.push({
        recipient: contact.email,
        reason: 'Duplicate within 30 days',
      });
      continue;
    }

    const gmailResult = await sendAutomationEmail(env, {
      recipient: contact.email,
      subject: outreachDraft.subject,
      body: outreachDraft.draft,
    });

    const sentAt = new Date().toISOString();
    const outreachPayload = {
      status: 'sent',
      sent_at: sentAt,
      gmail_message_id: gmailResult.id || '',
      gmail_thread_id: gmailResult.threadId || '',
      recipient: contact.email,
      recipient_type: contact.type,
    };

    if (index === 0) {
      await gateway.patch('outreach', [eq('id', outreachDraft.id)], outreachPayload);
    } else {
      await gateway.insert('outreach', {
        id: createId('outreach'),
        lead_id: lead.id,
        channel: outreachDraft.channel || 'email',
        recipient: contact.email,
        recipient_type: contact.type,
        subject: outreachDraft.subject || '',
        draft: outreachDraft.draft || '',
        plugin_line: outreachDraft.plugin_line || '',
        call_opener: outreachDraft.call_opener || '',
        follow_up_note: outreachDraft.follow_up_note || '',
        status: 'sent',
        sent_at: sentAt,
        gmail_message_id: gmailResult.id || '',
        gmail_thread_id: gmailResult.threadId || '',
        metadata: {
          ...(outreachDraft.metadata || {}),
          autoSend: true,
          autoRecipientRank: index + 1,
        },
      });
    }

    sentCount += 1;
    sentRecipients.push(contact.email);
  }

  if (sentCount === 0) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: skippedRecipients[0]?.reason || 'No automatic send was completed.',
      status: 'needs review',
    });
    return { sent: false, reason: skippedRecipients[0]?.reason || 'No automatic send was completed.' };
  }

  const sentAt = new Date().toISOString();
  await Promise.all([
    gateway.patch('leads', [eq('id', lead.id)], {
      status: 'contacted',
      last_contacted_at: sentAt,
      last_sent_at: sentAt,
      duplicate_guard_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
      auto_send_reason: sentRecipients.length > 1
        ? `Automatically emailed ${sentRecipients.length} strong contacts.`
        : 'Email sent automatically.',
    }),
    gateway.insert('activity_log', {
      id: createId('activity'),
      lead_id: lead.id,
      event_type: 'email_sent',
      summary: sentRecipients.length > 1 ? 'Emails sent automatically' : 'Email sent automatically',
      detail: `Sent to ${sentRecipients.join(', ')}`,
      metadata: {
        outreachId: outreachDraft.id,
        recipients: sentRecipients,
        skippedRecipients,
      },
    }),
  ]);

  return {
    sent: true,
    count: sentRecipients.length,
    recipient: sentRecipients[0] || '',
    recipients: sentRecipients,
    outreachId: outreachDraft.id,
    sendLimits,
  };
}

function mapSnapshot(snapshot) {
  const propertyMap = new Map(snapshot.properties.map((item) => [item.lead_id, item]));
  const companyMap = new Map(snapshot.companies.map((item) => [item.lead_id, item]));
  const contactsMap = new Map();
  const factsMap = new Map();
  const outreachMap = new Map();
  const activityMap = new Map();
  const candidatesMap = new Map();

  snapshot.contacts.forEach((contact) => {
    const list = contactsMap.get(contact.lead_id) || [];
    list.push(contact);
    contactsMap.set(contact.lead_id, list);
  });
  snapshot.facts.forEach((fact) => {
    const list = factsMap.get(fact.lead_id) || [];
    list.push(fact);
    factsMap.set(fact.lead_id, list);
  });
  snapshot.outreach.forEach((row) => {
    const list = outreachMap.get(row.lead_id) || [];
    list.push(row);
    outreachMap.set(row.lead_id, list);
  });
  snapshot.activity.forEach((row) => {
    const list = activityMap.get(row.lead_id) || [];
    list.push(row);
    activityMap.set(row.lead_id, list);
  });
  (snapshot.candidates || []).forEach((row) => {
    const list = candidatesMap.get(row.lead_id) || [];
    list.push(row);
    candidatesMap.set(row.lead_id, list);
  });
  const mappedJobs = (snapshot.jobs || []).map((job) => ({
    id: job.id,
    runId: job.run_id || job.id,
    parentJobId: job.parent_job_id || null,
    leadId: job.lead_id || null,
    jobType: job.job_type,
    status: job.status,
    provider: job.provider || 'worker',
    summary: job.summary || '',
    detail: job.detail || '',
    attemptCount: job.attempt_count || 1,
    maxAttempts: job.max_attempts || DEFAULT_JOB_MAX_ATTEMPTS,
    retryable: Boolean(job.retryable),
    createdAt: job.created_at,
    startedAt: job.started_at || null,
    finishedAt: job.finished_at || null,
    nextRetryAt: job.next_retry_at || null,
    errorCode: job.error_code || '',
    errorMessage: job.error_message || '',
    inputSnapshot: job.input_snapshot || {},
    outputSnapshot: job.output_snapshot || {},
    metadata: job.metadata || {},
  }));
  const latestRunRoot = [...mappedJobs]
    .filter((job) => job.jobType === 'scan_run')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] || null;
  const latestRunSummary = latestRunRoot ? buildRunSummary(latestRunRoot.id, snapshot.jobs || []) : null;

  const leads = snapshot.leads.map((lead) => {
    const permit = lead.raw_permit || {};
    const company = companyMap.get(lead.id) || {};
    const property = propertyMap.get(lead.id) || {};
    const contacts = contactsMap.get(lead.id) || [];
    const manualEnrichment = lead.enrichment_summary?.manualEnrichment || {};
    const scoreBreakdown = lead.score_breakdown && typeof lead.score_breakdown === 'object' ? lead.score_breakdown : {};
    const contactability = lead.contactability_breakdown && typeof lead.contactability_breakdown === 'object'
      ? lead.contactability_breakdown
      : {};
    const bestNextAction = lead.best_next_action && typeof lead.best_next_action === 'object'
      ? lead.best_next_action
      : {};
    const readiness = lead.enrichment_summary?.readiness && typeof lead.enrichment_summary.readiness === 'object'
      ? lead.enrichment_summary.readiness
      : {};
    const channelDecision = lead.enrichment_summary?.channelDecision && typeof lead.enrichment_summary.channelDecision === 'object'
      ? lead.enrichment_summary.channelDecision
      : {};
    const outreachHistory = (outreachMap.get(lead.id) || []).map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      recipient: item.recipient || '',
      recipientType: item.recipient_type || '',
      subject: item.subject || '',
      body: item.draft || '',
      pluginLine: item.plugin_line || '',
      callOpener: item.call_opener || '',
      followUpNote: item.follow_up_note || '',
      sentAt: item.sent_at,
      createdAt: item.created_at,
      scheduledFor: item.scheduled_for,
      messageId: item.gmail_message_id || '',
      metadata: item.metadata || {},
    }));

    const latestDraft = outreachHistory[0] || {};
    return {
      ...permit,
      id: lead.permit_key,
      score: lead.score,
      scoreBreakdown: {
        directKeyword: Number(scoreBreakdown.directKeyword || 0),
        inferredNeed: Number(scoreBreakdown.inferredNeed || 0),
        costSignal: Number(scoreBreakdown.costSignal || 0),
        commercialSignal: Number(scoreBreakdown.commercialSignal || 0),
        buildingTypeSignal: Number(scoreBreakdown.buildingTypeSignal || 0),
        recencyBonus: Number(scoreBreakdown.recencyBonus || 0),
        locationBonus: Number(scoreBreakdown.locationBonus || 0),
        negativeSignals: Number(scoreBreakdown.negativeSignals || 0),
        total: Number(scoreBreakdown.total || lead.score || 0),
        reasons: Array.isArray(scoreBreakdown.reasons) ? scoreBreakdown.reasons : [],
        disqualifiers: Array.isArray(scoreBreakdown.disqualifiers) ? scoreBreakdown.disqualifiers : [],
        summary: scoreBreakdown.summary || '',
        relevanceScore: Number(scoreBreakdown.relevanceScore || 0.3),
        relevanceKeyword: scoreBreakdown.relevanceKeyword || '',
        serviceAngle: scoreBreakdown.serviceAngle || 'custom glass scope',
      },
      relevanceScore: Number(scoreBreakdown.relevanceScore || 0.3),
      relevanceKeyword: scoreBreakdown.relevanceKeyword || '',
      serviceAngle: scoreBreakdown.serviceAngle || 'custom glass scope',
      qualityTier: lead.enrichment_summary?.qualityTier || lead.lead_tier || 'cold',
      leadTier: lead.lead_tier || getLeadTier(lead.score),
      contactability: {
        ownerPresent: Number(contactability.ownerPresent || 0),
        ownerBusinessPresent: Number(contactability.ownerBusinessPresent || 0),
        gcPresent: Number(contactability.gcPresent || 0),
        filingRepPresent: Number(contactability.filingRepPresent || 0),
        websiteFound: Number(contactability.websiteFound || 0),
        directEmailFound: Number(contactability.directEmailFound || 0),
        genericEmailFound: Number(contactability.genericEmailFound || 0),
        phoneFound: Number(contactability.phoneFound || 0),
        contactFormFound: Number(contactability.contactFormFound || 0),
        linkedInFound: Number(contactability.linkedInFound || 0),
        instagramFound: Number(contactability.instagramFound || 0),
        total: Number(contactability.total || lead.contactability_score || 0),
        label: contactability.label || lead.contactability_label || 'Weak',
        reasons: Array.isArray(contactability.reasons) ? contactability.reasons : [],
        missing: Array.isArray(contactability.missing) ? contactability.missing : [],
        explanation: contactability.explanation || '',
      },
      nextAction: Object.keys(bestNextAction).length > 0 ? {
        label: bestNextAction.label || 'Research needed',
        detail: bestNextAction.detail || lead.auto_send_reason || '',
        queue: bestNextAction.queue || 'research',
        urgency: bestNextAction.urgency || 'medium',
      } : {
        label: 'Research needed',
        detail: lead.auto_send_reason || '',
        queue: 'research',
        urgency: 'medium',
      },
      priorityLabel: lead.priority_label || 'Monitor',
      priorityScore: lead.priority_score || 0,
      humanSummary: lead.score_breakdown?.summary || '',
      projectTags: lead.project_tags || [],
      enrichment: {
        companyWebsite: manualEnrichment.companyWebsite || company.website || '',
        directEmail:
          manualEnrichment.directEmail ||
          contacts.find((contact) => contact.email && contact.type === 'verified')?.email ||
          '',
        genericEmail:
          manualEnrichment.genericEmail ||
          contacts.find((contact) => contact.email && contact.type === 'public')?.email ||
          '',
        phone: manualEnrichment.phone || contacts.find((contact) => contact.phone)?.phone || '',
        linkedInUrl:
          manualEnrichment.linkedInUrl ||
          company.linked_in_url ||
          contacts.find((contact) => contact.linkedin_url)?.linkedin_url ||
          '',
        instagramUrl:
          manualEnrichment.instagramUrl ||
          company.instagram_url ||
          contacts.find((contact) => contact.instagram_url)?.instagram_url ||
          '',
        contactFormUrl:
          manualEnrichment.contactFormUrl ||
          contacts.find((contact) => contact.contact_form_url)?.contact_form_url ||
          '',
        contactPersonName:
          manualEnrichment.contactPersonName ||
          contacts.find((contact) => contact.name)?.name ||
          permit.owner_name ||
          '',
        contactRole:
          manualEnrichment.contactRole ||
          contacts.find((contact) => contact.role)?.role ||
          company.role ||
          '',
        notes: manualEnrichment.notes || '',
        researchNotes: manualEnrichment.researchNotes || lead.auto_send_reason || '',
        sourceTags:
          manualEnrichment.sourceTags?.length > 0
            ? manualEnrichment.sourceTags
            : uniq([
                company.search_query ? 'brave' : '',
                property.place_id ? 'google-maps' : '',
                contacts.some((contact) => contact.source === 'firecrawl') ? 'firecrawl' : '',
              ]),
        confidenceTags:
          manualEnrichment.confidenceTags?.length > 0
            ? manualEnrichment.confidenceTags
            : [lead.company_match_strength || 'weak', lead.outreach_readiness_label || 'Needs Review'],
        followUpDate: manualEnrichment.followUpDate || '',
      },
      outreachDraft: {
        subject: latestDraft.subject || '',
        introLine: latestDraft.metadata?.introLine || latestDraft.body?.split('\n\n')[0] || '',
        shortEmail: latestDraft.body || '',
        callOpener: latestDraft.callOpener || '',
        followUpNote: latestDraft.followUpNote || '',
        updatedAt: latestDraft.createdAt || null,
      },
      activities: (activityMap.get(lead.id) || []).map((item) => ({
        id: item.id,
        type: mapActivityType(item.event_type),
        title: item.summary,
        detail: item.detail || '',
        createdAt: item.created_at,
      })),
      workflow: {
        status: normalizeStatusForUi(lead.status),
        ignored: lead.status === 'archived',
        nextActionDue: manualEnrichment.followUpDate || '',
        lastReviewedAt: lead.updated_at,
      },
      lastScannedAt: lead.last_scanned_at || lead.updated_at,
      scannedCount: 1,
      propertyProfile: {
        normalizedAddress: lead.normalized_address,
        neighborhood: property.neighborhood || '',
        buildingType: property.building_type || '',
        propertyClass: property.property_class || '',
        boroughConfidence: lead.property_confidence || 0,
        placeName: property.neighborhood || '',
        placeId: property.place_id || '',
        bin: property.bin || permit.bin || '',
        bbl: property.bbl || permit.bbl || '',
        block: property.block || permit.block || '',
        lot: property.lot || permit.lot || '',
        hpdSignal: property.hpd_summary?.count ? `${property.hpd_summary.count} HPD violations` : '',
        acrisSignal: property.acris_payload?.available ? 'ACRIS parcel found' : '',
        confidence: property.confidence || 0,
        sourceTags: uniq([
          property.pluto_payload && Object.keys(property.pluto_payload).length > 0 ? 'pluto' : '',
          property.hpd_summary && Object.keys(property.hpd_summary).length > 0 ? 'hpd' : '',
          property.acris_payload?.available ? 'acris' : '',
          property.place_id ? 'google-maps' : '',
        ]),
      },
      companyProfile: {
        name: company.company_name || '',
        normalizedName: company.normalized_name || '',
        role: company.role || 'owner',
        website: company.website || '',
        domain: company.domain || '',
        confidence: company.confidence || 0,
        description: company.description || '',
        searchQuery: company.search_query || '',
        matchStrength: company.match_strength || 'weak',
        linkedInUrl: company.linked_in_url || '',
        instagramUrl: company.instagram_url || '',
      },
      resolutionCandidates: (candidatesMap.get(lead.id) || []).map((candidate) => ({
        id: candidate.id,
        type: candidate.candidate_type === 'person' ? 'person' : 'company',
        role: candidate.role || '',
        label: candidate.label || '',
        url: candidate.url || '',
        domain: candidate.domain || '',
        source: candidate.source || '',
        confidence: candidate.confidence || 0,
        status:
          candidate.status === 'selected'
            ? 'selected'
            : candidate.status === 'rejected'
              ? 'rejected'
              : 'candidate',
        detail: candidate.metadata?.detail || '',
        matchedQuery: candidate.metadata?.matchedQuery || '',
      })),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name || '',
        role: contact.role || '',
        email: contact.email || '',
        phone: contact.phone || '',
        website: contact.website_url || '',
        linkedInUrl: contact.linkedin_url || '',
        instagramUrl: contact.instagram_url || '',
        contactFormUrl: contact.contact_form_url || '',
        source: contact.source,
        confidence: contact.confidence || 0,
        type: contact.type || 'public',
        verified: Boolean(contact.verified),
        isPrimary: Boolean(contact.is_primary),
      })),
      enrichmentFacts: (factsMap.get(lead.id) || []).map((fact) => ({
        id: fact.id,
        field: fact.field,
        value: fact.value,
        source: fact.source,
        confidence: fact.confidence || 0,
        note: fact.metadata?.note || '',
      })),
      outreachReadiness: {
        score: lead.outreach_readiness_score || 0,
        label: lead.outreach_readiness_label || 'Needs Review',
        explanation: readiness.explanation || '',
        blockers: Array.isArray(readiness.blockers) ? readiness.blockers : [],
      },
      channelDecision: {
        primary: lead.best_channel || 'email',
        reason: channelDecision.reason || '',
        alternatives: Array.isArray(channelDecision.alternatives) ? channelDecision.alternatives : [],
        autoSendEligible: Boolean(lead.auto_send_eligible),
        routeConfidence: Number(channelDecision.routeConfidence || 0),
        recipientType: channelDecision.recipientType || '',
        targetRole: channelDecision.targetRole || '',
        routeSource: channelDecision.routeSource || '',
      },
      outreachHistory,
      automationSummary: {
        companyMatchStrength: lead.company_match_strength || 'weak',
        enrichmentConfidence: lead.enrichment_confidence || 0,
        autoSendEligible: Boolean(lead.auto_send_eligible),
        autoSendReason: lead.auto_send_reason || '',
        lastAutomationRunAt: lead.last_enriched_at || lead.updated_at,
      },
    };
  });

  return {
    leads,
    sentLog: snapshot.outreach
      .filter((item) => item.status === 'sent')
      .map((item) => ({
        id: item.id,
        leadId: item.lead_id,
        channel: item.channel,
        recipient: item.recipient || '',
        subject: item.subject || '',
        sentAt: item.sent_at,
        status: item.status,
      })),
    jobs: mappedJobs,
    latestRunSummary,
  };
}

function normalizeStatusForUi(status) {
  switch (status) {
    case 'needs review':
      return 'reviewed';
    case 'email-required':
      return 'email-required';
    case 'outreach-ready':
      return 'outreach-ready';
    default:
      return status || 'new';
  }
}

function mapActivityType(eventType) {
  switch (eventType) {
    case 'lead_enriched':
    case 'manual_enrichment':
      return 'enriched';
    case 'contact_selected':
      return 'contact-found';
    case 'email_sent':
      return 'draft-created';
    case 'status_updated':
    case 'candidate_selected':
    case 'candidate_rejected':
      return 'status-changed';
    default:
      return 'reviewed';
  }
}

export async function runPermitAutomationCycle(env) {
  const gateway = createSupabaseGateway(env);
  return startScanRunInternal(env, gateway, {
    trigger: 'legacy_run',
  });
}

function needsAutomationPass(lead) {
  if (isAutomationTerminalStatus(lead.status)) {
    return false;
  }

  return (
    ['new', 'reviewed', 'researching', 'email-required'].includes(lead.status) ||
    (lead.contactability_score || 0) < 60 ||
    lead.outreach_readiness_label !== 'Ready'
  );
}

async function runPermitIngestInternal(env, gateway, options = {}) {
  return runAutomationJob(
    gateway,
    {
      jobType: 'permit_ingest',
      runId: options.runId || null,
      parentJobId: options.parentJobId || null,
      provider: 'dob',
      summary: 'Scanning NYC DOB permits',
      detail: 'Pulling fresh permits, scoring fit, and upserting lead rows.',
      retryable: true,
      inputSnapshot: {
        source: options.source || 'worker',
      },
      onSuccess: (result) => ({
        summary:
          result.ingested > 0
            ? `Ingested ${result.ingested} leads from ${result.scanned} scanned permits.`
            : `Scanned ${result.scanned} permits, but none cleared the fit thresholds.`,
        detail:
          result.ingested > 0
            ? result.duplicatesCollapsed > 0
              ? `Permit ingest completed, the queue was refreshed, and ${result.duplicatesCollapsed} duplicate permit rows were collapsed before save.`
              : 'Permit ingest completed and the lead queue was refreshed.'
            : 'Permit ingest completed, but nothing new matched the MetroGlassPro profile.',
        metadata: {
          scanned: result.scanned,
          ingested: result.ingested,
          duplicatesCollapsed: result.duplicatesCollapsed || 0,
          droppedWithoutKey: result.droppedWithoutKey || 0,
        },
      }),
    },
    async () => {
      const permits = await fetchDobPermits();
      const scoredRows = permits
        .map((permit) => ({
          permit,
          scoreBreakdown: buildLeadScore(permit),
        }))
        .filter((entry) => entry.scoreBreakdown.total > 0 && entry.scoreBreakdown.disqualifiers.length === 0)
        .map((entry) => buildLeadRow(entry.permit, entry.scoreBreakdown));

      const { rows: leadRows, duplicatesCollapsed, droppedWithoutKey } = dedupeLeadRows(scoredRows);

      if (leadRows.length === 0) {
        return {
          scanned: permits.length,
          ingested: 0,
          leads: [],
          duplicatesCollapsed,
          droppedWithoutKey,
        };
      }

      const ingested = await gateway.upsert('leads', leadRows, 'permit_key');
      return {
        scanned: permits.length,
        ingested: ingested.length,
        leads: ingested,
        duplicatesCollapsed,
        droppedWithoutKey,
      };
    },
    options,
  );
}

function buildRunSummary(runId, jobs = []) {
  const relevantJobs = jobs.filter((job) => (job.run_id || job.runId || job.id) === runId);
  const rootJob = relevantJobs.find((job) => job.id === runId) || null;
  const childJobs = relevantJobs.filter((job) => job.id !== runId);
  const statusCounts = childJobs.reduce((accumulator, job) => {
    accumulator[job.status] = (accumulator[job.status] || 0) + 1;
    return accumulator;
  }, {});
  const sentCount = childJobs.filter((job) => job.job_type === 'send' && job.status === 'succeeded').length;
  const completedLeadCount = new Set(
    childJobs
      .filter((job) => job.job_type === 'resolve' && job.status === 'succeeded' && job.lead_id)
      .map((job) => job.lead_id),
  ).size;
  const queuedLeadCount = Number(rootJob?.metadata?.queuedLeadCount || rootJob?.output_snapshot?.queuedLeadCount || 0);
  const scannedCount = Number(rootJob?.metadata?.scannedCount || rootJob?.output_snapshot?.scannedCount || 0);

  return {
    runId,
    status: rootJob?.status || 'queued',
    scannedCount,
    queuedLeadCount,
    completedLeadCount,
    sentCount,
    queuedJobs: Number(statusCounts.queued || 0),
    runningJobs: Number(statusCounts.running || 0),
    retryingJobs: Number(statusCounts.retrying || 0),
    failedJobs: Number(statusCounts.failed || 0),
    succeededJobs: Number(statusCounts.succeeded || 0),
    latestSummary: rootJob?.summary || childJobs[0]?.summary || 'Scan queued',
    updatedAt: rootJob?.updated_at || rootJob?.finished_at || rootJob?.created_at || new Date().toISOString(),
  };
}

async function finalizeAutomationRun(gateway, runId) {
  if (!runId) {
    return null;
  }

  const rootJob = await gateway.getAutomationJobById(runId);
  if (!rootJob) {
    return null;
  }

  const childJobs = await gateway.getRunChildren(runId, { excludeJobId: runId, pageLimit: 500 });
  const summary = buildRunSummary(runId, [rootJob, ...childJobs]);
  const pendingCount = summary.queuedJobs + summary.runningJobs + summary.retryingJobs;
  const status = pendingCount > 0 ? 'running' : summary.failedJobs > 0 ? 'failed' : 'succeeded';
  const finishedAt = pendingCount > 0 ? null : new Date().toISOString();
  const nextSummary =
    status === 'running'
      ? `Scan queued ${summary.queuedLeadCount} leads, ${summary.completedLeadCount} resolved so far.`
      : status === 'failed'
        ? `Scan finished with ${summary.failedJobs} failed jobs.`
        : summary.sentCount > 0
          ? `Scan completed, ${summary.completedLeadCount} leads resolved and ${summary.sentCount} emails sent.`
          : `Scan completed, ${summary.completedLeadCount} leads resolved.`;

  await gateway.safePatchAutomationJob(runId, {
    status,
    summary: nextSummary,
    detail:
      status === 'running'
        ? 'Background ingest, resolve, draft, and send jobs are still processing.'
        : status === 'failed'
          ? 'One or more background jobs failed. Review the run ledger and retry what matters.'
          : 'All currently queued background jobs finished.',
    finished_at: finishedAt,
    output_snapshot: summary,
    metadata: {
      ...(rootJob.metadata || {}),
      scannedCount: summary.scannedCount,
      queuedLeadCount: summary.queuedLeadCount,
      completedLeadCount: summary.completedLeadCount,
      sentCount: summary.sentCount,
    },
  });

  return {
    ...summary,
    status,
    latestSummary: nextSummary,
    updatedAt: finishedAt || new Date().toISOString(),
  };
}

async function startScanRunInternal(env, gateway, options = {}) {
  const runId = options.runId || createId();
  const startedAt = new Date().toISOString();

  await queueAutomationJob(gateway, {
    id: runId,
    runId,
    jobType: 'scan_run',
    status: 'running',
    provider: 'worker',
    summary: 'Starting background scan',
    detail: 'Pulling permits and queueing resolve, draft, and send jobs in the background.',
    retryable: false,
    maxAttempts: 1,
    metadata: {
      trigger: options.trigger || 'manual',
    },
    inputSnapshot: {
      trigger: options.trigger || 'manual',
    },
    startedAt,
  });

  try {
    const ingestResult = await runPermitIngestInternal(env, gateway, {
      runId,
      parentJobId: runId,
      source: options.trigger || 'manual',
    });

    const queueTargets = ingestResult.leads || [];
    await Promise.all(
      queueTargets.map((lead) =>
        queueAutomationJob(gateway, {
          runId,
          parentJobId: runId,
          leadId: lead.id,
          jobType: 'resolve',
          provider: 'worker',
          summary: `Resolve ${lead.address}`,
          detail: 'Resolve company, people, contact routes, and draft readiness for this lead.',
          retryable: true,
          maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
          inputSnapshot: {
            leadId: lead.id,
            permitKey: lead.permit_key,
            address: lead.address,
          },
        }),
      ),
    );

    await gateway.safePatchAutomationJob(runId, {
      summary:
        queueTargets.length > 0
          ? `Queued ${queueTargets.length} leads from ${ingestResult.scanned} scanned permits.`
          : `Scanned ${ingestResult.scanned} permits, but nothing new matched the queue.`,
      detail:
        queueTargets.length > 0
          ? 'Background resolve, draft, and send jobs are now draining.'
          : 'The scan completed without queueing any new lead work.',
      metadata: {
        trigger: options.trigger || 'manual',
        scannedCount: ingestResult.scanned,
        ingested: ingestResult.ingested,
        queuedLeadCount: queueTargets.length,
        duplicatesCollapsed: ingestResult.duplicatesCollapsed || 0,
      },
      output_snapshot: {
        scannedCount: ingestResult.scanned,
        queuedLeadCount: queueTargets.length,
      },
      finished_at: queueTargets.length > 0 ? null : new Date().toISOString(),
      status: queueTargets.length > 0 ? 'running' : 'succeeded',
    });

    return {
      runId,
      scannedCount: ingestResult.scanned,
      queuedLeadCount: queueTargets.length,
    };
  } catch (error) {
    await gateway.safePatchAutomationJob(runId, {
      status: 'failed',
      summary: 'Scan run failed before queueing',
      detail: summarizeError(error),
      error_code: detectJobProvider(error, 'worker'),
      error_message: summarizeError(error),
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

async function runEnrichmentBatchInternal(env, gateway, candidateLeads = [], options = {}) {
  const limit = options.limit || ENRICHMENT_BATCH_LIMIT;
  return runAutomationJob(
    gateway,
    {
      jobType: 'enrichment_batch',
      provider: 'worker',
      summary: 'Running enrichment batch',
      detail: 'Resolving companies, contact routes, and draft readiness for the top queue.',
      retryable: true,
      onSuccess: (result) => ({
        summary:
          result.failed > 0
            ? `Enriched ${result.enriched} leads, ${result.failed} still need attention.`
            : `Enriched ${result.enriched} leads with ${result.sent} sends completed.`,
        detail:
          result.failed > 0
            ? 'The batch completed, but one or more leads still need a retry or manual review.'
            : 'The batch completed without a logged failure.',
        metadata: {
          attempted: result.attempted,
          enriched: result.enriched,
          failed: result.failed,
          sent: result.sent,
          failures: result.failures,
        },
      }),
    },
    async () => {
      const fallbackQueue =
        candidateLeads.length > 0
          ? candidateLeads
          : await gateway.select('leads', {
              ordering: [order('score', 'desc'), order('updated_at', 'desc')],
              pageLimit: Math.max(limit * 4, 16),
            });

      const queue = [...fallbackQueue]
        .filter(needsAutomationPass)
        .sort((left, right) => (right.score || 0) - (left.score || 0))
        .slice(0, limit);

      const enriched = [];
      const failures = [];
      let sent = 0;

      for (const lead of queue) {
        try {
          const enrichedLead = await runAutomationJob(
            gateway,
            {
              jobType: 'lead_enrichment',
              provider: 'worker',
              leadId: lead.id,
              summary: `Refreshing ${lead.address}`,
              detail: 'Running company, contact, and draft resolution for one lead.',
              retryable: true,
              onSuccess: () => ({
                summary: `Enriched ${lead.address}`,
                detail: 'Resolver data, contact routes, and outreach draft were refreshed for this lead.',
              }),
            },
            async () => enrichLead(env, gateway, lead),
          );

          enriched.push(enrichedLead);
          const sendResult = await maybeAutoSend(env, gateway, enrichedLead);
          if (sendResult.sent) {
            sent += Number(sendResult.count || 1);
          }
        } catch (error) {
          failures.push({
            leadId: lead.id,
            error: summarizeError(error),
          });
        }
      }

      return {
        attempted: queue.length,
        enriched: enriched.length,
        failed: failures.length,
        failures,
        sent,
        leads: enriched,
      };
    },
    options,
  );
}

function shouldQueueSendAfterResolve(enriched) {
  const lead = enriched?.lead || {};
  const company = enriched?.companyProfile || lead.enrichment_summary?.company || {};
  const contacts = enriched?.contacts || [];
  const latestDraft = enriched?.outreachDraft || {};
  const emailContacts = getAutoSendEmailContacts(contacts, company, lead.raw_permit || lead);

  return Boolean(
    AUTO_SEND_ENABLED &&
    lead.auto_send_eligible &&
    emailContacts.length > 0 &&
    latestDraft.subject &&
    latestDraft.draft,
  );
}

async function processQueuedAutomationJob(env, gateway, job) {
  switch (job.job_type) {
    case 'resolve': {
      if (!job.lead_id) {
        throw new Error('Resolve job is missing its lead reference');
      }

      await runAutomationJob(
        gateway,
        {
          jobType: 'resolve',
          runId: job.run_id || null,
          parentJobId: job.parent_job_id || null,
          provider: 'worker',
          leadId: job.lead_id,
          summary: job.summary || 'Resolving lead',
          detail: job.detail || 'Refreshing company, person, contact, and draft state.',
          retryable: true,
          maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
          inputSnapshot: job.input_snapshot || job.inputSnapshot || {},
          onSuccess: (result) => ({
            summary: `Resolved ${result.lead.address}`,
            detail: result.lead.auto_send_eligible
              ? 'Lead resolved cleanly and is ready for guarded auto-send.'
              : 'Lead resolved cleanly and is waiting on a stronger route or manual review.',
            outputSnapshot: {
              permitKey: result.lead.permit_key,
              address: result.lead.address,
              company: result.companyProfile?.company_name || '',
              route: result.lead.best_channel || '',
              autoSendEligible: Boolean(result.lead.auto_send_eligible),
            },
          }),
        },
        async () => {
          const leadRow = await gateway.getLeadById(job.lead_id);
          if (!leadRow) {
            throw new Error('Lead not found');
          }

          const enriched = await enrichLead(env, gateway, leadRow, { force: true });

          await queueAutomationJob(gateway, {
            runId: job.run_id || null,
            parentJobId: job.id,
            leadId: job.lead_id,
            jobType: 'enrich',
            status: 'succeeded',
            provider: 'worker',
            summary: `Enriched ${enriched.lead.address}`,
            detail: 'Company, contacts, and trust state were refreshed.',
            retryable: false,
            maxAttempts: 1,
            inputSnapshot: job.input_snapshot || job.inputSnapshot || {},
            outputSnapshot: {
              company: enriched.companyProfile?.company_name || '',
              route: enriched.lead.best_channel || '',
              routeConfidence: enriched.lead.enrichment_summary?.channelDecision?.routeConfidence || 0,
            },
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });

          await queueAutomationJob(gateway, {
            runId: job.run_id || null,
            parentJobId: job.id,
            leadId: job.lead_id,
            jobType: 'draft',
            status: 'succeeded',
            provider: 'worker',
            summary: `Draft prepared for ${enriched.lead.address}`,
            detail: 'One best outreach draft, phone opener, and follow-up note were refreshed.',
            retryable: false,
            maxAttempts: 1,
            inputSnapshot: {
              channel: enriched.lead.best_channel || '',
            },
            outputSnapshot: {
              recipient: enriched.outreachDraft?.recipient || '',
              subject: enriched.outreachDraft?.subject || '',
            },
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });

          if (shouldQueueSendAfterResolve(enriched)) {
            await queueAutomationJob(gateway, {
              runId: job.run_id || null,
              parentJobId: job.id,
              leadId: job.lead_id,
              jobType: 'send',
              provider: 'gmail',
              summary: `Send ${enriched.lead.address}`,
              detail: 'Deliver guarded outreach to the strongest aligned email routes.',
              retryable: true,
              maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
              inputSnapshot: {
                address: enriched.lead.address,
                permitKey: enriched.lead.permit_key,
              },
            });
          }

          return enriched;
        },
        { existingJob: job },
      );
      break;
    }
    case 'send':
      if (!job.lead_id) {
        throw new Error('Send job is missing its lead reference');
      }
      await sendLeadNowInternal(env, gateway, job.lead_id, { existingJob: job, mode: 'auto' });
      break;
    case 'lead_enrichment':
      if (!job.lead_id) {
        throw new Error('Enrichment job is missing its lead reference');
      }
      await enrichLeadNowInternal(env, gateway, job.lead_id, { existingJob: job });
      break;
    case 'draft_refresh':
      if (!job.lead_id) {
        throw new Error('Draft job is missing its lead reference');
      }
      await refreshLeadDraftNowInternal(env, gateway, job.lead_id, { existingJob: job });
      break;
    default:
      throw new Error(`Unsupported queued job type: ${job.job_type}`);
  }

  if (job.run_id) {
    await finalizeAutomationRun(gateway, job.run_id);
  }
}

async function drainAutomationQueueInternal(env, gateway, options = {}) {
  const maxJobs = options.limit || SEND_BATCH_LIMIT + ENRICHMENT_BATCH_LIMIT;
  const nowIso = new Date().toISOString();
  const jobs = await gateway.getRunnableAutomationJobs(nowIso, maxJobs);
  const touchedRuns = new Set();

  for (const job of jobs) {
    if (!job || job.job_type === 'scan_run' || job.job_type === 'permit_ingest') {
      continue;
    }

    try {
      await processQueuedAutomationJob(env, gateway, job);
    } catch {
      // Job state is already patched inside runAutomationJob.
    }

    if (job.run_id) {
      touchedRuns.add(job.run_id);
    }
  }

  for (const runId of touchedRuns) {
    await finalizeAutomationRun(gateway, runId);
  }

  return {
    processed: jobs.length,
  };
}

export async function runPermitIngest(env) {
  const gateway = createSupabaseGateway(env);
  return runPermitIngestInternal(env, gateway);
}

export async function runEnrichmentBatch(env, options = {}) {
  const gateway = createSupabaseGateway(env);
  const queue = await gateway.select('leads', {
    ordering: [order('score', 'desc'), order('updated_at', 'desc')],
    pageLimit: Math.max((options.limit || ENRICHMENT_BATCH_LIMIT) * 4, 16),
  });

  const result = await runEnrichmentBatchInternal(env, gateway, queue, {
    limit: options.limit || ENRICHMENT_BATCH_LIMIT,
  });

  return {
    attempted: result.attempted,
    enriched: result.enriched,
    sent: result.sent,
  };
}

async function loadLeadAutomationContext(gateway, leadId) {
  const [company, property, contacts, latestDraft] = await Promise.all([
    gateway.select('company_profiles', {
      filters: [eq('lead_id', leadId)],
      pageLimit: 1,
    }),
    gateway.select('property_profiles', {
      filters: [eq('lead_id', leadId)],
      pageLimit: 1,
    }),
    gateway.select('contacts', {
      filters: [eq('lead_id', leadId)],
      ordering: [order('is_primary', 'desc'), order('confidence', 'desc')],
      pageLimit: 100,
    }),
    gateway.select('outreach', {
      filters: [eq('lead_id', leadId)],
      ordering: [order('created_at', 'desc')],
      pageLimit: 1,
    }),
  ]);

  return {
    company: company[0] || {},
    property: property[0] || {},
    contacts,
    latestDraft: latestDraft[0] || null,
  };
}

async function recomputeLeadAutomationState(gateway, leadRow, options = {}) {
  const context = await loadLeadAutomationContext(gateway, leadRow.id);
  const derivedState = buildDerivedLeadState({
    leadRow,
    companyProfile: context.company,
    propertyProfile: context.property,
    contacts: context.contacts,
    promoteDrafted: Boolean(options.promoteDrafted),
  });

  const payload = {
    lead_tier: derivedState.qualityTier === 'dead' ? 'cold' : derivedState.qualityTier,
    priority_label: derivedState.priorityLabel,
    priority_score: derivedState.priorityScore,
    status: options.overrideStatus || derivedState.status,
    contactability_score: derivedState.contactability.total,
    contactability_label: derivedState.contactability.label,
    outreach_readiness_score: derivedState.readiness.score,
    outreach_readiness_label: derivedState.readiness.label,
    linkedin_worthy: derivedState.channelDecision.primary === 'linkedin',
    best_channel: derivedState.channelDecision.primary,
    best_next_action: derivedState.nextAction,
    contactability_breakdown: derivedState.contactability,
    enrichment_confidence: derivedState.enrichmentConfidence,
    auto_send_eligible: derivedState.autoSendEligible,
    auto_send_reason: derivedState.autoSendReason,
    enrichment_summary: {
      ...(leadRow.enrichment_summary || {}),
      readiness: derivedState.readiness,
      channelDecision: derivedState.channelDecision,
      qualityTier: derivedState.qualityTier,
    },
  };

  const updated = await gateway.patch('leads', [eq('id', leadRow.id)], payload);
  return updated[0] || { ...leadRow, ...payload };
}

function getCandidateMatchStrength(confidence) {
  return confidence >= 76 ? 'strong' : confidence >= 52 ? 'medium' : 'weak';
}

function normalizeCandidateWebsite(candidate) {
  if (!candidate?.url) {
    return candidate?.domain ? `https://${candidate.domain}` : '';
  }

  return candidate.url.startsWith('http') ? candidate.url : `https://${candidate.url}`;
}

function getCandidatePersonName(candidate) {
  const label = candidate?.label || '';
  const trimmed = label.split('|')[0]?.split(' - ')[0]?.split(',')[0]?.trim();
  return trimmed || label || '';
}

async function applyCandidateDecision(gateway, lead, candidateId, mode) {
  const candidates = await gateway.getResolutionCandidates(lead.id);
  if (candidates.length === 0) {
    throw new Error('No resolver candidates stored yet. Run enrichment first.');
  }

  const target = candidates.find((candidate) => candidate.id === candidateId);
  if (!target) {
    throw new Error('Resolver candidate not found');
  }

  const siblingCandidates = candidates
    .filter((candidate) => candidate.candidate_type === target.candidate_type)
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));

  let fallbackSelectedId = '';
  if (mode === 'reject' && target.status === 'selected') {
    fallbackSelectedId = siblingCandidates.find((candidate) => candidate.id !== target.id && candidate.status !== 'rejected')?.id || '';
  }

  await Promise.all(
    siblingCandidates.map((candidate) => {
      let status = candidate.status || 'candidate';

      if (mode === 'select') {
        status = candidate.id === target.id ? 'selected' : 'rejected';
      } else if (candidate.id === target.id) {
        status = 'rejected';
      } else if (candidate.id === fallbackSelectedId) {
        status = 'selected';
      } else if (candidate.status === 'selected' && !fallbackSelectedId) {
        status = 'candidate';
      }

      return gateway.patchResolutionCandidate(candidate.id, { status });
    }),
  );

  if (target.candidate_type === 'company') {
    const companyProfile = (
      await gateway.select('company_profiles', {
        filters: [eq('lead_id', lead.id)],
        pageLimit: 1,
      })
    )[0] || {};

    const selectedCompany =
      mode === 'select'
        ? target
        : siblingCandidates.find((candidate) => candidate.id === fallbackSelectedId) || null;

    const nextCompanyPayload = selectedCompany
      ? {
          company_name: selectedCompany.label || companyProfile.company_name || '',
          normalized_name: normalizeText(selectedCompany.label || companyProfile.company_name || ''),
          role: selectedCompany.role || companyProfile.role || 'owner',
          website: normalizeCandidateWebsite(selectedCompany) || companyProfile.website || '',
          domain: selectedCompany.domain || rootDomain(selectedCompany.url || '') || companyProfile.domain || '',
          confidence: Math.round(selectedCompany.confidence || 0),
          description: selectedCompany.metadata?.detail || companyProfile.description || '',
          match_strength: getCandidateMatchStrength(Math.round(selectedCompany.confidence || 0)),
        }
      : {
          confidence: 0,
          match_strength: 'weak',
          website: '',
          domain: '',
        };

    await gateway.upsert('company_profiles', [{ ...companyProfile, ...nextCompanyPayload, lead_id: lead.id }], 'lead_id');
  }

  if (target.candidate_type === 'person' && mode === 'select') {
    const nextManualEnrichment = {
      ...(lead.enrichment_summary?.manualEnrichment || {}),
      contactPersonName: getCandidatePersonName(target),
      contactRole: target.role || lead.enrichment_summary?.manualEnrichment?.contactRole || '',
      linkedInUrl:
        normalizeText(target.url).includes('linkedin.com')
          ? target.url
          : lead.enrichment_summary?.manualEnrichment?.linkedInUrl || '',
    };

    await gateway.patch('leads', [eq('id', lead.id)], {
      enrichment_summary: {
        ...(lead.enrichment_summary || {}),
        manualEnrichment: nextManualEnrichment,
      },
    });
  }

  await gateway.insert('activity_log', {
    id: createId('activity'),
    lead_id: lead.id,
    event_type: mode === 'select' ? 'candidate_selected' : 'candidate_rejected',
    summary: mode === 'select' ? 'Resolver candidate accepted' : 'Resolver candidate rejected',
    detail: `${target.label || 'Candidate'} was ${mode === 'select' ? 'accepted' : 'rejected'} by the operator.`,
    metadata: {
      candidateId: target.id,
      candidateType: target.candidate_type,
      role: target.role || '',
    },
  });

  const latestLead = (await gateway.getLeadById(lead.id)) || lead;
  await recomputeLeadAutomationState(gateway, latestLead);
}

async function setPrimaryContactSelection(gateway, lead, contactId) {
  const contacts = await gateway.select('contacts', {
    filters: [eq('lead_id', lead.id)],
    ordering: [order('is_primary', 'desc'), order('confidence', 'desc')],
    pageLimit: 100,
  });

  if (contacts.length === 0) {
    throw new Error('No contacts stored yet for this lead');
  }

  const target = contacts.find((contact) => contact.id === contactId);
  if (!target) {
    throw new Error('Contact not found');
  }

  const nextContacts = contacts.map((contact) => ({
    ...contact,
    is_primary: contact.id === contactId,
  }));

  await gateway.replaceContacts(lead.id, nextContacts);
  await gateway.insert('activity_log', {
    id: createId('activity'),
    lead_id: lead.id,
    event_type: 'contact_selected',
    summary: 'Primary contact updated',
    detail: `${target.name || target.email || target.phone || 'Contact'} is now the primary route.`,
    metadata: {
      contactId: target.id,
    },
  });

  const latestLead = (await gateway.getLeadById(lead.id)) || lead;
  await recomputeLeadAutomationState(gateway, latestLead);
}

async function loadLeadForAction(gateway, leadId) {
  return (await gateway.getLeadByPermitKey(leadId)) || (await gateway.getLeadById(leadId));
}

export async function getPermitAutomationSnapshot(env) {
  const gateway = createSupabaseGateway(env);
  const snapshot = await gateway.getQueueSnapshot();
  return mapSnapshot(snapshot);
}

export async function getAutomationJobs(env, options = {}) {
  const gateway = createSupabaseGateway(env);
  const leadRow = options.leadId ? await loadLeadForAction(gateway, options.leadId) : null;
  const jobs = await gateway.getAutomationJobs({
    runId: options.runId || null,
    leadId: leadRow?.id || null,
    pageLimit: options.pageLimit || 500,
  });
  const latestRunRoot = [...jobs]
    .filter((job) => job.job_type === 'scan_run')
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] || null;

  return {
    jobs: jobs.map((job) => ({
      id: job.id,
      runId: job.run_id || job.id,
      parentJobId: job.parent_job_id || null,
      leadId: job.lead_id || null,
      jobType: job.job_type,
      status: job.status,
      provider: job.provider || 'worker',
      summary: job.summary || '',
      detail: job.detail || '',
      attemptCount: job.attempt_count || 1,
      maxAttempts: job.max_attempts || DEFAULT_JOB_MAX_ATTEMPTS,
      retryable: Boolean(job.retryable),
      createdAt: job.created_at,
      startedAt: job.started_at || null,
      finishedAt: job.finished_at || null,
      nextRetryAt: job.next_retry_at || null,
      errorCode: job.error_code || '',
      errorMessage: job.error_message || '',
      inputSnapshot: job.input_snapshot || {},
      outputSnapshot: job.output_snapshot || {},
      metadata: job.metadata || {},
    })),
    latestRunSummary: latestRunRoot ? buildRunSummary(latestRunRoot.id, jobs) : null,
  };
}

export async function startScanRun(env, options = {}) {
  const gateway = createSupabaseGateway(env);
  return startScanRunInternal(env, gateway, options);
}

export async function drainAutomationQueue(env, options = {}) {
  const gateway = createSupabaseGateway(env);
  return drainAutomationQueueInternal(env, gateway, options);
}

async function enrichLeadNowInternal(env, gateway, leadId, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  await runAutomationJob(
    gateway,
    {
      jobType: 'lead_enrichment',
      provider: 'worker',
      leadId: lead.id,
      summary: `Refreshing ${lead.address}`,
      detail: 'Running manual enrichment for the selected lead.',
      retryable: true,
      onSuccess: () => ({
        summary: `Enrichment refreshed for ${lead.address}`,
        detail: 'Manual enrichment completed and the route decision was recalculated.',
      }),
    },
    async () => enrichLead(env, gateway, lead, { force: true }),
    options,
  );

  return getPermitAutomationSnapshot(env);
}

export async function enrichLeadNow(env, leadId) {
  const gateway = createSupabaseGateway(env);
  return enrichLeadNowInternal(env, gateway, leadId);
}

async function refreshLeadDraftNowInternal(env, gateway, leadId, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  await runAutomationJob(
    gateway,
    {
      jobType: 'draft_refresh',
      provider: 'worker',
      leadId: lead.id,
      summary: `Refreshing draft for ${lead.address}`,
      detail: 'Rebuilding the outreach draft from the latest resolver data.',
      retryable: true,
      onSuccess: () => ({
        summary: `Draft refreshed for ${lead.address}`,
        detail: 'The worker rebuilt the latest outreach draft from resolver-backed data.',
      }),
    },
    async () => {
      const context = await loadLeadAutomationContext(gateway, lead.id);
      const draft = buildDraft({ ...lead, best_channel: lead.best_channel || 'email' }, context.company, context.contacts);

      await upsertDraftRecord(
        gateway,
        lead.id,
        {
          channel: lead.best_channel || 'email',
          recipient: draft.recipient || '',
          recipientType: draft.recipientType || lead.best_channel || 'email',
          subject: draft.subject,
          body: draft.body,
          pluginLine: draft.pluginLine,
          callOpener: draft.callOpener,
          followUpNote: draft.followUpNote,
          status: 'draft',
          metadata: {
            introLine: draft.introLine,
            refreshedFromResolver: true,
            updatedAt: new Date().toISOString(),
          },
        },
        context.latestDraft,
      );

      await recomputeLeadAutomationState(gateway, lead, { promoteDrafted: true });
    },
    options,
  );

  return getPermitAutomationSnapshot(env);
}

export async function refreshLeadDraftNow(env, leadId) {
  const gateway = createSupabaseGateway(env);
  return refreshLeadDraftNowInternal(env, gateway, leadId);
}

async function selectLeadCandidateInternal(env, gateway, leadId, candidateId, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  await runAutomationJob(
    gateway,
    {
      jobType: 'candidate_select',
      provider: 'worker',
      leadId: lead.id,
      summary: `Accepting resolver candidate for ${lead.address}`,
      detail: 'Promoting the selected company or person candidate into the trusted path.',
      retryable: false,
      onSuccess: () => ({
        summary: `Resolver candidate accepted for ${lead.address}`,
        detail: 'The chosen candidate is now driving trust, route, and draft decisions.',
      }),
    },
    async () => applyCandidateDecision(gateway, lead, candidateId, 'select'),
    options,
  );

  return getPermitAutomationSnapshot(env);
}

async function rejectLeadCandidateInternal(env, gateway, leadId, candidateId, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  await runAutomationJob(
    gateway,
    {
      jobType: 'candidate_reject',
      provider: 'worker',
      leadId: lead.id,
      summary: `Rejecting resolver candidate for ${lead.address}`,
      detail: 'Removing a candidate from the trusted resolver path.',
      retryable: false,
      onSuccess: () => ({
        summary: `Resolver candidate rejected for ${lead.address}`,
        detail: 'The rejected candidate was removed from the trusted resolver path.',
      }),
    },
    async () => applyCandidateDecision(gateway, lead, candidateId, 'reject'),
    options,
  );

  return getPermitAutomationSnapshot(env);
}

async function setLeadPrimaryContactInternal(env, gateway, leadId, contactId, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  await runAutomationJob(
    gateway,
    {
      jobType: 'primary_contact',
      provider: 'worker',
      leadId: lead.id,
      summary: `Promoting a primary route for ${lead.address}`,
      detail: 'Making one contact the default route for channel choice and send.',
      retryable: false,
      onSuccess: () => ({
        summary: `Primary route updated for ${lead.address}`,
        detail: 'The selected contact now anchors route choice and readiness.',
      }),
    },
    async () => setPrimaryContactSelection(gateway, lead, contactId),
    options,
  );

  return getPermitAutomationSnapshot(env);
}

function getStateMutationJobConfig(lead, patch) {
  if (patch.enrichment) {
    return {
      jobType: 'manual_enrichment',
      summary: `Saving manual enrichment for ${lead.address}`,
      detail: 'Persisting workspace research and refreshing the decision state.',
    };
  }

  if (patch.draft) {
    return {
      jobType: 'draft_refresh',
      summary: `Saving draft changes for ${lead.address}`,
      detail: 'Persisting outreach edits and keeping the route state in sync.',
    };
  }

  return {
    jobType: 'status_update',
    summary: `Updating pipeline state for ${lead.address}`,
    detail: 'Persisting a status change and refreshing the next-action state.',
  };
}

async function updateLeadAutomationStateInternal(env, gateway, leadId, patch, options = {}) {
  const lead = await loadLeadForAction(gateway, leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const jobConfig = getStateMutationJobConfig(lead, patch);

  await runAutomationJob(
    gateway,
    {
      jobType: jobConfig.jobType,
      provider: 'worker',
      leadId: lead.id,
      summary: jobConfig.summary,
      detail: jobConfig.detail,
      retryable: false,
      onSuccess: () => ({
        summary: jobConfig.summary.replace(/^Saving|^Updating/, 'Updated'),
        detail: 'The worker saved the change and recalculated the decision state.',
      }),
    },
    async () => {
      let workingLead = lead;
      let explicitStatus = '';

      if (patch.status) {
        explicitStatus = patch.status;
        const updated = await gateway.patch('leads', [eq('id', lead.id)], { status: patch.status });
        workingLead = updated[0] || { ...workingLead, status: patch.status };
        await gateway.insert('activity_log', {
          id: createId(),
          lead_id: lead.id,
          event_type: 'status_updated',
          summary: 'Lead status updated',
          detail: `Status moved to ${patch.status}`,
          metadata: {},
        });
      }

      if (patch.enrichment) {
        const existingContacts = await gateway.select('contacts', {
          filters: [eq('lead_id', lead.id)],
          ordering: [order('is_primary', 'desc'), order('confidence', 'desc')],
          pageLimit: 100,
        });
        const nextManualEnrichment = {
          ...(workingLead.enrichment_summary?.manualEnrichment || {}),
          ...patch.enrichment,
        };
        const preservedContacts = existingContacts.filter((contact) => contact.source !== 'manual');
        const manualContacts = [];

        if (
          nextManualEnrichment.directEmail ||
          nextManualEnrichment.phone ||
          nextManualEnrichment.companyWebsite ||
          nextManualEnrichment.linkedInUrl ||
          nextManualEnrichment.instagramUrl ||
          nextManualEnrichment.contactFormUrl
        ) {
          manualContacts.push({
            id: createId(),
            name: nextManualEnrichment.contactPersonName || '',
            role: nextManualEnrichment.contactRole || '',
            email: nextManualEnrichment.directEmail || '',
            phone: nextManualEnrichment.phone || '',
            website_url: nextManualEnrichment.companyWebsite || '',
            linkedin_url: nextManualEnrichment.linkedInUrl || '',
            instagram_url: nextManualEnrichment.instagramUrl || '',
            contact_form_url: nextManualEnrichment.contactFormUrl || '',
            type: nextManualEnrichment.directEmail ? 'verified' : 'public',
            confidence: nextManualEnrichment.directEmail ? 88 : 70,
            source: 'manual',
            verified: Boolean(nextManualEnrichment.directEmail),
            is_primary: true,
          });
        }

        if (nextManualEnrichment.genericEmail) {
          manualContacts.push({
            id: createId(),
            name: nextManualEnrichment.contactPersonName || '',
            role: nextManualEnrichment.contactRole || '',
            email: nextManualEnrichment.genericEmail,
            phone: nextManualEnrichment.phone || '',
            website_url: nextManualEnrichment.companyWebsite || '',
            linkedin_url: nextManualEnrichment.linkedInUrl || '',
            instagram_url: nextManualEnrichment.instagramUrl || '',
            contact_form_url: nextManualEnrichment.contactFormUrl || '',
            type: 'public',
            confidence: 72,
            source: 'manual',
            verified: false,
            is_primary: manualContacts.length === 0,
          });
        }

        const updated = await gateway.patch('leads', [eq('id', lead.id)], {
          enrichment_summary: {
            ...(workingLead.enrichment_summary || {}),
            manualEnrichment: nextManualEnrichment,
          },
        });
        workingLead = updated[0] || {
          ...workingLead,
          enrichment_summary: {
            ...(workingLead.enrichment_summary || {}),
            manualEnrichment: nextManualEnrichment,
          },
        };
        await gateway.replaceContacts(lead.id, [...preservedContacts, ...manualContacts]);
        await gateway.insert('activity_log', {
          id: createId(),
          lead_id: lead.id,
          event_type: 'manual_enrichment',
          summary: 'Lead enrichment updated',
          detail: 'Manual enrichment changes were saved from the workspace.',
          metadata: {},
        });
      }

      if (patch.draft) {
        const hasDraftField = (field) => Object.prototype.hasOwnProperty.call(patch.draft, field);

        await upsertDraftRecord(gateway, lead.id, {
          channel: 'email',
          recipient: hasDraftField('recipient') ? patch.draft.recipient || '' : undefined,
          recipientType: hasDraftField('recipientType') ? patch.draft.recipientType || 'manual' : undefined,
          subject: hasDraftField('subject') ? patch.draft.subject || '' : undefined,
          body: hasDraftField('body') ? patch.draft.body || '' : undefined,
          pluginLine: hasDraftField('pluginLine') ? patch.draft.pluginLine || '' : undefined,
          callOpener: hasDraftField('callOpener') ? patch.draft.callOpener || '' : undefined,
          followUpNote: hasDraftField('followUpNote') ? patch.draft.followUpNote || '' : undefined,
          status: 'draft',
          metadata: {
            introLine: hasDraftField('introLine') ? patch.draft.introLine || '' : undefined,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      await recomputeLeadAutomationState(gateway, workingLead, {
        promoteDrafted: Boolean(patch.draft),
        overrideStatus: explicitStatus || undefined,
      });
    },
    options,
  );
  return getPermitAutomationSnapshot(env);
}

export async function selectLeadCandidate(env, leadId, candidateId) {
  const gateway = createSupabaseGateway(env);
  return selectLeadCandidateInternal(env, gateway, leadId, candidateId);
}

export async function rejectLeadCandidate(env, leadId, candidateId) {
  const gateway = createSupabaseGateway(env);
  return rejectLeadCandidateInternal(env, gateway, leadId, candidateId);
}

export async function setLeadPrimaryContact(env, leadId, contactId) {
  const gateway = createSupabaseGateway(env);
  return setLeadPrimaryContactInternal(env, gateway, leadId, contactId);
}

export async function updateLeadAutomationState(env, leadId, patch) {
  const gateway = createSupabaseGateway(env);
  return updateLeadAutomationStateInternal(env, gateway, leadId, patch);
}

async function sendLeadNowInternal(env, gateway, leadId, options = {}) {
  const leadRow = await loadLeadForAction(gateway, leadId);
  if (!leadRow) {
    throw new Error('Lead not found');
  }

  const snapshot = await gateway.getQueueSnapshot();
  const mapped = mapSnapshot(snapshot);
  const lead = mapped.leads.find((item) => item.id === leadRow.permit_key) || null;
  if (!lead) {
    throw new Error('Lead not found');
  }

  return runAutomationJob(
    gateway,
    {
      jobType: 'send',
      provider: 'gmail',
      leadId: leadRow.id,
      summary: `Sending outreach for ${lead.address}`,
      detail: 'Delivering the current email draft through Gmail.',
      retryable: true,
      onSuccess: (result) => ({
        summary: `Sent outreach for ${lead.address}`,
        detail: result.recipient ? `Email delivered to ${result.recipient}.` : 'The latest draft was sent.',
        metadata: {
          recipient: result.recipient || '',
          sentAt: result.sentAt || null,
        },
      }),
    },
    async () => {
      const contacts = lead.contacts || [];
      const latestOutreach = lead.outreachHistory?.[0];
      if (!latestOutreach?.subject || !latestOutreach?.body) {
        throw new Error('No draft available to send');
      }

      const emailContacts = options.mode === 'auto'
        ? getAutoSendEmailContacts(contacts, lead.companyProfile || {}, lead)
        : getManualSendEmailContacts(contacts, lead.companyProfile || {}, lead);
      if (emailContacts.length === 0) {
        throw new Error('No email available');
      }

      const duplicateSince = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
      const sentRecipients = [];
      const skippedRecipients = [];

      for (const [index, contact] of emailContacts.entries()) {
        const isDuplicate = await gateway.hasDuplicateOutreach(contact.email, duplicateSince);
        if (isDuplicate) {
          skippedRecipients.push({
            recipient: contact.email,
            reason: 'Duplicate within 30 days',
          });
          continue;
        }

        const gmailResult = await sendAutomationEmail(env, {
          recipient: contact.email,
          subject: latestOutreach.subject,
          body: latestOutreach.body,
        });

        const sentAt = new Date().toISOString();
        const outreachPayload = {
          status: 'sent',
          sent_at: sentAt,
          gmail_message_id: gmailResult.id || '',
          gmail_thread_id: gmailResult.threadId || '',
          recipient: contact.email,
          recipient_type: contact.type,
        };

        if (index === 0) {
          await gateway.patch('outreach', [eq('id', latestOutreach.id)], outreachPayload);
        } else {
          await gateway.insert('outreach', {
            id: createId('outreach'),
            lead_id: leadRow.id,
            channel: latestOutreach.channel || 'email',
            recipient: contact.email,
            recipient_type: contact.type,
            subject: latestOutreach.subject || '',
            draft: latestOutreach.body || '',
            plugin_line: latestOutreach.pluginLine || '',
            call_opener: latestOutreach.callOpener || '',
            follow_up_note: latestOutreach.followUpNote || '',
            status: 'sent',
            sent_at: sentAt,
            gmail_message_id: gmailResult.id || '',
            gmail_thread_id: gmailResult.threadId || '',
            metadata: {
              ...(latestOutreach.metadata || {}),
              manualSend: true,
              recipientRank: index + 1,
            },
          });
        }

        sentRecipients.push(contact.email);
      }

      if (sentRecipients.length === 0) {
        throw new Error(skippedRecipients[0]?.reason || 'No email could be sent');
      }

      const sentAt = new Date().toISOString();
      await gateway.patch('leads', [eq('permit_key', lead.id)], {
        status: 'contacted',
        last_contacted_at: sentAt,
        last_sent_at: sentAt,
        duplicate_guard_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
        auto_send_reason: options.mode === 'auto'
          ? sentRecipients.length > 1
            ? `Automatically emailed ${sentRecipients.length} guarded contacts.`
            : 'Email sent automatically.'
          : sentRecipients.length > 1
            ? `Operator sent email to ${sentRecipients.length} contacts.`
            : 'Email sent manually by operator.',
      });

      const latestLead = (await gateway.getLeadById(leadRow.id)) || leadRow;
      if (latestLead) {
        await recomputeLeadAutomationState(gateway, latestLead, {
          overrideStatus: 'contacted',
        });
      }

      return {
        success: true,
        recipient: sentRecipients[0],
        recipients: sentRecipients,
        sentAt,
      };
    },
    options,
  );
}

export async function sendLeadNow(env, leadId) {
  const gateway = createSupabaseGateway(env);
  return sendLeadNowInternal(env, gateway, leadId);
}

export async function retryAutomationJob(env, jobId) {
  const gateway = createSupabaseGateway(env);
  const job = await gateway.getAutomationJobById(jobId);
  if (!job) {
    throw new Error('Automation job not found');
  }

  if (!job.retryable) {
    throw new Error('This job is not retryable');
  }

  await gateway.safePatchAutomationJob(job.id, {
    status: 'queued',
    detail: job.detail || '',
    next_retry_at: null,
    error_code: null,
    error_message: null,
  });

  return getPermitAutomationSnapshot(env);
}
