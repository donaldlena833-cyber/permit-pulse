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
const SEND_BATCH_LIMIT = 4;
const AUTO_SEND_ENABLED = true;
const ZEROBOUNCE_ENABLED = false;
const AUTO_SEND_EMAIL_SCORE_THRESHOLD = 50;
const MANUAL_SEND_EMAIL_SCORE_THRESHOLD = 25;
const AUTO_SEND_EMAIL_CONTACT_LIMIT = 1;
const MANUAL_SEND_EMAIL_CONTACT_LIMIT = 1;
const EMAIL_RESEARCH_ONLY_THRESHOLD = 25;
const DOMAIN_HEALTH_CACHE_DAYS = 7;
const PERSON_VERIFICATION_CACHE_DAYS = 30;
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
const GENERIC_MAILBOX_LOCALS = [
  'info',
  'sales',
  'contact',
  'hello',
  'office',
  'admin',
  'support',
  'estimating',
  'billing',
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
const STALE_PAGE_PHRASES = [
  'this domain is for sale',
  'under construction',
  'coming soon',
  'parked by',
  'buy this domain',
  'this page is not available',
  'website expired',
  'account suspended',
  "this site can't be reached",
  'godaddy',
  'squarespace expir',
  'wix expir',
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

async function runAutomationJob(gateway, config, work, options = {}) {
  const startedAt = new Date().toISOString();
  const existingJob = options.existingJob || null;
  let job = existingJob;

  if (existingJob) {
    const patched = await gateway.safePatchAutomationJob(existingJob.id, {
      status: 'retrying',
      provider: config.provider || existingJob.provider || 'worker',
      summary: config.summary || existingJob.summary || '',
      detail: config.detail || existingJob.detail || '',
      retryable: Boolean(config.retryable),
      attempt_count: Math.max(Number(existingJob.attempt_count || 1) + 1, 2),
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
      status: 'retrying',
      attempt_count: Math.max(Number(existingJob.attempt_count || 1) + 1, 2),
      started_at: startedAt,
      finished_at: null,
    };
  } else {
    const inserted = await gateway.safeInsertAutomationJob({
      id: createId(),
      lead_id: config.leadId || null,
      job_type: config.jobType,
      status: 'running',
      provider: config.provider || 'worker',
      summary: config.summary,
      detail: config.detail || '',
      attempt_count: 1,
      retryable: Boolean(config.retryable),
      metadata: config.metadata || {},
      started_at: startedAt,
      finished_at: null,
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
        provider: successPayload.provider || config.provider || job.provider || 'worker',
        summary: successPayload.summary || config.summary,
        detail: successPayload.detail || config.detail || '',
        retryable: false,
        finished_at: new Date().toISOString(),
        metadata: {
          ...(job.metadata || {}),
          ...(successPayload.metadata || {}),
        },
      });
    }

    return result;
  } catch (error) {
    if (job?.id) {
      await gateway.safePatchAutomationJob(job.id, {
        status: 'failed',
        provider: detectJobProvider(error, config.provider || job.provider || 'worker'),
        detail: summarizeError(error),
        retryable: Boolean(config.retryable),
        finished_at: new Date().toISOString(),
        metadata: {
          ...(job.metadata || {}),
          error: summarizeError(error),
        },
      });
    }

    throw error;
  }
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

function getMailboxLocalType(local = '') {
  const normalized = normalizeText(local);
  return GENERIC_MAILBOX_LOCALS.includes(normalized) ? 'generic' : 'named';
}

function inferEmailPattern(email = '') {
  const normalized = normalizeEmailAddress(email);
  const local = emailLocalPart(normalized);
  if (!local) {
    return '';
  }

  if (local.includes('.')) {
    return 'first.last';
  }

  if (/^[a-z][a-z]+$/.test(local)) {
    return 'first';
  }

  if (/^[a-z][a-z]+[a-z][a-z]+$/.test(local)) {
    return 'firstlast';
  }

  if (/^[a-z][a-z]+$/.test(local.replace(/[0-9]/g, ''))) {
    return 'first';
  }

  if (/^[a-z][a-z]+[a-z]+$/.test(local) && local.length >= 5) {
    return 'firstlast';
  }

  if (/^[a-z][a-z]+$/.test(local) && local.length <= 4) {
    return 'first';
  }

  if (/^[a-z][a-z]+[a-z]$/.test(local)) {
    return 'flast';
  }

  if (/^[a-z][a-z]+/.test(local) && !local.includes('.') && local.length >= 3) {
    return local.length <= 5 ? 'first' : 'firstlast';
  }

  return 'other';
}

function extractTextSnippet(text = '', needle = '') {
  const normalizedText = String(text || '');
  const normalizedNeedle = String(needle || '').trim();
  if (!normalizedText || !normalizedNeedle) {
    return '';
  }

  const lower = normalizedText.toLowerCase();
  const index = lower.indexOf(normalizedNeedle.toLowerCase());
  if (index === -1) {
    return normalizedText.slice(0, 160).trim();
  }

  const start = Math.max(0, index - 70);
  const end = Math.min(normalizedText.length, index + normalizedNeedle.length + 70);
  return normalizedText.slice(start, end).replace(/\s+/g, ' ').trim();
}

function extractHeading(markdown = '') {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
}

function detectPageType(url = '', content = '') {
  const normalizedUrl = normalizeText(url);
  const heading = normalizeText(extractHeading(content));
  const combined = `${normalizedUrl} ${heading}`;

  if (
    combined.includes('/contact')
    || combined.includes('contact-us')
    || combined.includes('get in touch')
    || combined.includes('contact')
  ) {
    return 'contact';
  }

  if (combined.includes('/about') || combined.includes('about us') || combined.includes('our story')) {
    return 'about';
  }

  if (
    combined.includes('/team')
    || combined.includes('/staff')
    || combined.includes('meet our')
    || combined.includes('our team')
  ) {
    return 'team';
  }

  if (normalizedUrl.includes('/blog') || normalizedUrl.includes('/news')) {
    return 'blog';
  }

  return normalizedUrl || heading ? 'other' : 'unknown';
}

function detectExtractionMethod(text = '', email = '') {
  const content = String(text || '');
  if (content.includes(`mailto:${email}`)) {
    return 'mailto_link';
  }

  if (content.includes('"email"') || content.includes("'email'")) {
    return 'structured_data';
  }

  return 'text_scrape';
}

function checkPageStaleness(page = {}) {
  const content = normalizeText([page.text || '', page.markdown || '', page.html || ''].join(' '));
  const signals = {
    is_stale: false,
    stale_reasons: [],
    age_penalty: 0,
  };

  const copyrightMatch = content.match(/(?:©|copyright)\s*(20\d{2})/);
  if (copyrightMatch) {
    const year = Number.parseInt(copyrightMatch[1], 10);
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;
    if (age >= 4) {
      signals.is_stale = true;
      signals.stale_reasons.push(`Copyright year ${year}, ${age} years old`);
      signals.age_penalty = Math.min(age * 5, 30);
    } else if (age >= 2) {
      signals.stale_reasons.push(`Copyright year ${year}`);
      signals.age_penalty = age * 3;
    }
  }

  const parkedPhrase = STALE_PAGE_PHRASES.find((phrase) => content.includes(phrase));
  if (parkedPhrase) {
    signals.is_stale = true;
    signals.stale_reasons.push(`Parked or dead page signal: ${parkedPhrase}`);
    signals.age_penalty = Math.max(signals.age_penalty, 50);
  }

  const textOnly = String(page.text || page.markdown || '').trim();
  if (textOnly.length > 0 && textOnly.length < 200) {
    signals.stale_reasons.push('Very thin page content');
    signals.age_penalty += 10;
  }

  return signals;
}

function buildEmailProvenance({
  source = 'unknown',
  url = '',
  pageType = 'unknown',
  extractionMethod = 'text_scrape',
  rawContext = '',
  foundAt,
  staleness = null,
  domainHealth = null,
}) {
  return {
    source,
    url,
    page_type: pageType,
    extraction_method: extractionMethod,
    found_at: foundAt || new Date().toISOString(),
    raw_context: rawContext,
    staleness: staleness || undefined,
    domain_health: domainHealth || undefined,
  };
}

function applyTimeDecay(trustScore, foundAt) {
  if (!foundAt) {
    return trustScore * 0.7;
  }

  const ageMs = Date.now() - new Date(foundAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 3) return trustScore * 1.0;
  if (ageDays <= 7) return trustScore * 0.95;
  if (ageDays <= 14) return trustScore * 0.85;
  if (ageDays <= 30) return trustScore * 0.7;
  if (ageDays <= 60) return trustScore * 0.5;
  return trustScore * 0.3;
}

function getReputationMultiplier(reputationScore) {
  if (reputationScore >= 70) return 1.2;
  if (reputationScore >= 40) return 1.0;
  if (reputationScore >= 20) return 0.6;
  return 0.2;
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function looksParkedContent(content = '', finalUrl = '') {
  const lower = normalizeText(`${content} ${finalUrl}`);
  return STALE_PAGE_PHRASES.some((phrase) => lower.includes(phrase));
}

async function checkDomainHealth(env, gateway, domain) {
  const normalizedDomain = normalizeText(domain);
  if (!normalizedDomain) {
    return {
      domain: '',
      has_mx: false,
      has_website: false,
      is_parked: false,
      mx_records: [],
      health_score: 0,
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (DOMAIN_HEALTH_CACHE_DAYS * 86400000)).toISOString(),
    };
  }

  if (isFreeMailboxDomain(normalizedDomain)) {
    return {
      domain: normalizedDomain,
      has_mx: true,
      has_website: true,
      is_parked: false,
      mx_records: [{ exchange: normalizedDomain }],
      health_score: 100,
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (DOMAIN_HEALTH_CACHE_DAYS * 86400000)).toISOString(),
    };
  }

  const cached = await gateway.getDomainHealth(normalizedDomain);
  if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
    return cached;
  }

  const result = {
    domain: normalizedDomain,
    has_mx: false,
    has_website: false,
    is_parked: false,
    mx_records: [],
    health_score: 0,
    checked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (DOMAIN_HEALTH_CACHE_DAYS * 86400000)).toISOString(),
  };

  try {
    const dnsPayload = await fetchJson(
      `${API_ENDPOINTS.cloudflareDns}?${new URLSearchParams({ name: normalizedDomain, type: 'MX' }).toString()}`,
      {
        headers: {
          Accept: 'application/dns-json',
        },
      },
    );
    const answers = Array.isArray(dnsPayload?.Answer) ? dnsPayload.Answer : [];
    result.mx_records = answers.map((answer) => ({
      data: answer.data || '',
      ttl: answer.TTL || 0,
    }));
    result.has_mx = result.mx_records.length > 0;
  } catch {
    result.has_mx = false;
  }

  try {
    const websiteResponse = await fetchWithTimeout(`https://${normalizedDomain}`, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'MetroGlass Leads/1.0',
      },
    }, 3000);
    const text = websiteResponse.ok ? await websiteResponse.text() : '';
    result.has_website = websiteResponse.ok && text.trim().length > 100;
    result.is_parked = looksParkedContent(text, websiteResponse.url || '');
  } catch {
    result.has_website = false;
  }

  if (!result.has_mx) {
    result.health_score = 0;
  } else if (result.has_website && !result.is_parked) {
    result.health_score = 100;
  } else if (result.has_mx && !result.has_website) {
    result.health_score = 50;
  } else if (result.has_mx && result.is_parked) {
    result.health_score = 20;
  }

  await gateway.upsertDomainHealth(result);
  return result;
}

async function getDomainReputationSnapshot(gateway, domain) {
  const normalizedDomain = normalizeText(domain);
  if (!normalizedDomain) {
    return null;
  }

  const cached = await gateway.getDomainReputation(normalizedDomain);
  if (cached) {
    return cached;
  }

  return {
    domain: normalizedDomain,
    total_sent: 0,
    total_delivered: 0,
    total_bounced: 0,
    total_replied: 0,
    reputation_score: 50,
  };
}

async function recordEmailOutcome(gateway, {
  leadId,
  email,
  outcome,
  sentAt,
  bounceType = '',
  bounceReason = '',
  countAsSend = true,
}) {
  const normalizedEmail = normalizeEmailAddress(email);
  const domain = emailDomain(normalizedEmail);
  const local = emailLocalPart(normalizedEmail);
  const pattern = inferEmailPattern(normalizedEmail);
  const outcomeAt = new Date().toISOString();

  await gateway.insertEmailOutcome({
    id: createId(),
    lead_id: leadId,
    email_address: normalizedEmail,
    domain,
    local_part: local,
    email_pattern: pattern || null,
    outcome,
    bounce_type: bounceType || null,
    bounce_reason: bounceReason || null,
    sent_at: sentAt,
    outcome_at: outcomeAt,
  });

  const previous = await getDomainReputationSnapshot(gateway, domain);
  const next = {
    domain,
    total_sent: Number(previous?.total_sent || 0) + (countAsSend ? 1 : 0),
    total_delivered: Number(previous?.total_delivered || 0) + (outcome === 'delivered' || outcome === 'replied' ? 1 : 0),
    total_bounced: Number(previous?.total_bounced || 0) + (outcome === 'bounced' ? 1 : 0),
    total_replied: Number(previous?.total_replied || 0) + (outcome === 'replied' ? 1 : 0),
    delivery_rate: 0,
    last_bounce_at: outcome === 'bounced' ? outcomeAt : previous?.last_bounce_at || null,
    last_success_at: outcome === 'delivered' || outcome === 'replied' ? outcomeAt : previous?.last_success_at || null,
    reputation_score: clamp(
      Number(previous?.reputation_score || 50)
        + (outcome === 'replied' ? 5 : 0)
        + (outcome === 'delivered' ? 2 : 0)
        - (outcome === 'bounced' && bounceType === 'hard' ? 15 : 0)
        - (outcome === 'bounced' && bounceType !== 'hard' ? 5 : 0)
        - (outcome === 'opted_out' ? 10 : 0),
      0,
      100,
    ),
    updated_at: outcomeAt,
  };

  next.delivery_rate = next.total_sent > 0 ? Number((next.total_delivered / next.total_sent).toFixed(2)) : null;
  await gateway.upsertDomainReputation(next);
  return next;
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

function contactMatchesKnownPerson(contact, permit = {}) {
  const haystack = normalizeText([
    contact?.name,
    contact?.role,
    contact?.email,
    contact?.linkedin_url,
  ].filter(Boolean).join(' '));
  const tokens = getKnownPersonTokens(permit);
  return tokens.length > 0 && countTokenMatches(tokens, haystack) > 0;
}

function contactMatchesKnownCompany(contact, companyProfile = {}, permit = {}) {
  const haystack = normalizeText([
    contact?.name,
    contact?.role,
    contact?.email,
    contact?.website_url,
    contact?.contact_form_url,
    companyProfile?.company_name,
  ].filter(Boolean).join(' '));
  const tokens = getKnownCompanyTokens(companyProfile, permit);
  return tokens.length > 0 && countTokenMatches(tokens, haystack) > 0;
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

function getPermitReference(lead) {
  return lead.permit_key || lead.job_filing_number || '';
}

function chooseDraftCta(lead, role, projectAngle, relevanceScore, strategy = 'estimate') {
  if (strategy === 'takeoff' || ((role.includes('applicant') || role.includes('gc') || role.includes('contractor')) && lead.score >= 65)) {
    return 'If drawings are available, I can turn around a quick glass takeoff and budget this week.';
  }

  if (strategy === 'quick-call') {
    return 'If useful, I can make time for a quick call this week and see if the glass scope is a fit for us.';
  }

  if (strategy === 'redirect') {
    return 'If someone else on the project is handling the glass package, feel free to point me in the right direction and I will keep it simple.';
  }

  if (relevanceScore >= 0.85) {
    return 'If helpful, I can send over a quick number or take a fast look at the plans this week.';
  }

  if (
    projectAngle.includes('storefront')
    || projectAngle.includes('partition')
    || projectAngle.includes('shower')
    || projectAngle.includes('mirror')
  ) {
    return `If that ${projectAngle} scope is still open, I can send a practical price range and next steps.`;
  }

  return 'If the glass scope is still open, I would be happy to send pricing or talk through it briefly this week.';
}

function getDraftValueLine(role, projectAngle) {
  if (role.includes('applicant') || role.includes('gc') || role.includes('contractor')) {
    return `We handle ${projectAngle}, mirrors, storefront work, and interior glass across the city, and we keep pricing and field coordination straightforward for active jobs.`;
  }

  if (role.includes('filing') || role.includes('architect') || role.includes('design')) {
    return `We handle ${projectAngle} and related interior glass work, and we can support pricing or coordination if the team still needs a glass partner.`;
  }

  return `We handle ${projectAngle}, mirrors, storefront work, and interior glass from pricing through install across the city.`;
}

function chooseDraftStrategy(lead, role, projectAngle, companyProfile, primaryContact) {
  const routeType = normalizeText(primaryContact?.type || '');
  const routeRole = normalizeText(primaryContact?.role || role || '');
  const relevanceScore = Number(lead.score_breakdown?.relevanceScore || lead.scoreBreakdown?.relevanceScore || 0.3);
  const companySignal = normalizeText(companyProfile.description || '');

  if (routeRole.includes('filing') || routeRole.includes('architect') || routeRole.includes('design')) {
    return 'redirect';
  }

  if (routeRole.includes('applicant') || routeRole.includes('gc') || routeRole.includes('contractor')) {
    if (lead.score >= 65 || projectAngle.includes('storefront') || projectAngle.includes('partition')) {
      return 'takeoff';
    }
  }

  if (routeType === 'guessed') {
    return 'quick-call';
  }

  if (relevanceScore >= 0.82 || companySignal.includes('commercial') || companySignal.includes('contractor')) {
    return 'estimate';
  }

  return 'quick-call';
}

function buildDraftIntro(lead, projectAngle, relevanceKeyword, role, strategy = 'estimate') {
  const projectDescription = sanitizeOutreachCopy(lead.description || lead.raw_permit?.job_description || '');
  const trimmedDescription = projectDescription
    ? projectDescription.charAt(0).toLowerCase() + projectDescription.slice(1, 140)
    : '';
  const address = sanitizeOutreachCopy(lead.address);

  if (strategy === 'redirect') {
    return sanitizeOutreachCopy(
      `I came across the permit at ${address} and wanted to reach out in case you are the right person to point me toward whoever is handling the ${projectAngle}.`,
    );
  }

  if (role.includes('applicant') || role.includes('gc') || role.includes('contractor')) {
    return sanitizeOutreachCopy(
      trimmedDescription
        ? `I came across the permit at ${address}. It looks like ${trimmedDescription}, and I wanted to reach out in case your team still needs a glass contractor on the job.`
        : `I came across the permit at ${address} and wanted to reach out in case your team still needs a glass contractor on the job.`,
    );
  }

  if (trimmedDescription) {
    return sanitizeOutreachCopy(
      `I came across the permit at ${address}. It looks like ${trimmedDescription}, and I wanted to reach out in case the glass scope is still open.`,
    );
  }

  return sanitizeOutreachCopy(
    `I came across the permit at ${address} and wanted to reach out in case the glass scope is still open.`,
  );
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

  const directEmail = contacts.find((contact) => contact.email && buildEmailTrust(contact, companyProfile, permit).assessment?.sendableAuto);
  const publicEmail = contacts.find(
    (contact) => contact.email && buildEmailTrust(contact, companyProfile, permit).assessment?.sendableManual,
  );
  const guessedEmail = contacts.find(
    (contact) => contact.email && buildEmailTrust(contact, companyProfile, permit).assessment?.researchOnly,
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
  return getMailboxLocalType(local) === 'generic';
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
  const companyMatches = countTokenMatches(companyTokens, `${localSearchable} ${domain}`);
  const matchesOfficialDomain = Boolean(
    officialDomain && (domain === officialDomain || domain.endsWith(`.${officialDomain}`)),
  );
  const freeMailbox = isFreeMailboxDomain(domain);
  const genericMailbox = isGenericMailbox(normalizedEmail);
  const guessed = source === 'pattern_guess';

  if (!domain || isBlockedEmailDomain(domain) || isPlaceholderMailbox(normalizedEmail)) {
    return {
      accept: false,
      confidence: 0,
      score: 0,
      domain,
      genericMailbox,
      freeMailbox,
      guessed,
      matchesOfficialDomain,
      personMatches,
      companyMatches,
      sendableAuto: false,
      sendableManual: false,
      researchOnly: true,
      reason: 'Blocked, placeholder, or junk email.',
      positives: [],
      negatives: ['Blocked or placeholder email'],
    };
  }

  if (!matchesOfficialDomain && !freeMailbox && companyMatches === 0) {
    return {
      accept: false,
      confidence: 0,
      score: 0,
      domain,
      genericMailbox,
      freeMailbox,
      guessed,
      matchesOfficialDomain,
      personMatches,
      companyMatches,
      sendableAuto: false,
      sendableManual: false,
      researchOnly: true,
      reason: 'Email domain does not align with the chosen company.',
      positives: [],
      negatives: ['Unrelated non-free domain'],
    };
  }

  if (freeMailbox && personMatches === 0 && companyMatches === 0) {
    return {
      accept: false,
      confidence: 0,
      score: 0,
      domain,
      genericMailbox,
      freeMailbox,
      guessed,
      matchesOfficialDomain,
      personMatches,
      companyMatches,
      sendableAuto: false,
      sendableManual: false,
      researchOnly: true,
      reason: 'Free mailbox has no supporting person or company match.',
      positives: [],
      negatives: ['Free mailbox without any entity alignment'],
    };
  }

  return {
    accept: true,
    confidence: 0,
    score: 0,
    domain,
    genericMailbox,
    freeMailbox,
    guessed,
    matchesOfficialDomain,
    personMatches,
    companyMatches,
    sendableAuto: false,
    sendableManual: false,
    researchOnly: false,
    reason: 'Email candidate needs evidence-based scoring.',
    positives: [],
    negatives: [],
  };
}

function buildEmailTrust(contact, companyProfile = {}, permit = {}) {
  if (!contact?.email) {
    return {
      score: 0,
      aligned: false,
      reason: 'No email route exists.',
      assessment: null,
    };
  }

  const storedBreakdown = contact.trust_breakdown && typeof contact.trust_breakdown === 'object'
    ? contact.trust_breakdown
    : null;
  if (storedBreakdown?.score !== undefined) {
    return {
      score: Math.round(Number(storedBreakdown.score || 0)),
      aligned: Boolean(storedBreakdown.entityAligned),
      reason: storedBreakdown.reason || 'Trust score stored during enrichment.',
      assessment: storedBreakdown.assessment || null,
      personAligned: Boolean(storedBreakdown.personAligned),
      companyAligned: Boolean(storedBreakdown.companyAligned),
      breakdown: storedBreakdown,
    };
  }

  const provenance = contact.provenance && typeof contact.provenance === 'object'
    ? contact.provenance
    : {};
  const assessment = assessEmailCandidate(contact.email, {
    companyProfile,
    permit,
    source: provenance.source || contact.source || '',
  });
  if (!assessment.accept) {
    return {
      score: 0,
      aligned: false,
      reason: assessment.reason || 'This email is not trustworthy enough to use.',
      assessment,
      personAligned: false,
      companyAligned: false,
      breakdown: {
        score: 0,
        reason: assessment.reason || 'Rejected email candidate.',
        positives: assessment.positives || [],
        negatives: assessment.negatives || [],
      },
    };
  }

  const personAligned = contactMatchesKnownPerson(contact, permit);
  const companyAligned = contactMatchesKnownCompany(contact, companyProfile, permit);
  const entityAligned =
    assessment.matchesOfficialDomain ||
    companyAligned ||
    personAligned ||
    (provenance.source || contact.source) === 'manual';

  const positives = [];
  const negatives = [];
  let score = 0;

  const pageType = provenance.page_type || 'unknown';
  const extractionMethod = provenance.extraction_method || 'text_scrape';
  const staleness = provenance.staleness || {};
  const domainHealth = provenance.domain_health || {};
  const domainHealthScore = Number(
    domainHealth.health_score ?? (assessment.freeMailbox ? 100 : assessment.matchesOfficialDomain ? 60 : 40),
  );
  const reputation = Number(contact.domain_reputation_score || contact.trust_breakdown?.domainReputationScore || 50);
  const reverseVerification = contact.person_verification || null;
  const source = provenance.source || contact.source || '';

  if (domainHealthScore === 0) {
    negatives.push('Domain has no MX records');
    return {
      score: 0,
      aligned: false,
      reason: 'Domain cannot receive mail.',
      assessment: {
        ...assessment,
        sendableAuto: false,
        sendableManual: false,
        researchOnly: true,
      },
      personAligned,
      companyAligned,
      breakdown: {
        score: 0,
        reason: 'Domain has no MX records.',
        positives,
        negatives,
      },
    };
  }

  if (pageType === 'contact' || pageType === 'about' || pageType === 'team') {
    const value = extractionMethod === 'mailto_link' ? 25 : 20;
    positives.push(`Found on ${pageType} page`);
    score += value;
  } else if (pageType === 'footer') {
    positives.push('Found in site footer');
    score += 10;
  } else if (pageType === 'blog' || pageType === 'other') {
    positives.push('Found on site page');
    score += 5;
  } else if (source === 'manual') {
    positives.push('Entered manually');
    score += 3;
  } else if (pageType === 'unknown') {
    positives.push('Unknown page source');
    score += 3;
  }

  if (extractionMethod === 'mailto_link' && assessment.matchesOfficialDomain) {
    positives.push('Mailto link on official site');
    score += 20;
  }

  if (personAligned) {
    positives.push('Name matches permit contact');
    score += 15;
  } else {
    negatives.push('No person name alignment');
    score -= 5;
  }

  if (assessment.matchesOfficialDomain) {
    positives.push('Domain matches resolved company');
    score += 10;
  }

  if ((source === 'google_maps' || extractionMethod === 'structured_data') && contact.email) {
    positives.push('Business profile source');
    score += 10;
  }

  if (assessment.companyMatches > 0) {
    positives.push('Company token appears in domain or local part');
    score += 5;
  } else {
    negatives.push('No company name alignment');
    score -= 5;
  }

  if (assessment.personMatches > 0) {
    positives.push('Person token appears in local part');
    score += 5;
  }

  if (source === 'manual') {
    positives.push('Operator entered this route');
    score += 3;
  }

  if (assessment.guessed || contact.type === 'guessed') {
    negatives.push('Pattern guessed email');
    score -= 30;
  }

  if (assessment.freeMailbox) {
    negatives.push('Free mailbox');
    score -= 25;
  }

  if (assessment.genericMailbox) {
    negatives.push('Generic inbox');
    score -= 15;
  }

  if (source === 'firecrawl' && !['contact', 'about', 'team', 'footer'].includes(pageType)) {
    negatives.push('Found on low-context scraped page');
    score -= 10;
  }

  if (Number(staleness.age_penalty || 0) > 0) {
    negatives.push(`Stale page penalty ${staleness.age_penalty}`);
    score -= Number(staleness.age_penalty || 0);
  }

  if (domainHealthScore > 0 && domainHealthScore < 30) {
    negatives.push('Domain health is weak');
    score = Math.min(score, 20);
  }

  if (!entityAligned && !assessment.freeMailbox) {
    negatives.push('Entity alignment is weak');
    score -= 20;
  }

  if (reverseVerification?.verified) {
    positives.push('Person verified at company');
    score += 12;
  } else if (reverseVerification && reverseVerification.confidence === 0) {
    negatives.push('Reverse verification points to a different company');
    score -= 30;
  } else if (reverseVerification && reverseVerification.confidence > 0 && reverseVerification.confidence < 0.5) {
    negatives.push('Could not verify person at company');
    score -= 15;
  }

  score = applyTimeDecay(score, provenance.found_at);
  score *= getReputationMultiplier(reputation);
  const normalizedScore = clamp(Math.round(score), 0, 100);
  const researchOnly = assessment.guessed || normalizedScore < EMAIL_RESEARCH_ONLY_THRESHOLD || domainHealthScore < 30;
  const sendableAuto =
    normalizedScore >= AUTO_SEND_EMAIL_SCORE_THRESHOLD
    && !assessment.guessed
    && !assessment.freeMailbox
    && domainHealthScore >= 50;
  const sendableManual =
    normalizedScore >= MANUAL_SEND_EMAIL_SCORE_THRESHOLD
    && !assessment.guessed
    && domainHealthScore > 0;

  let reason = 'Evidence is still thin.';
  if (positives.includes('Mailto link on official site')) {
    reason = 'Mailto link on the official site.';
  } else if (positives.includes('Found on contact page')) {
    reason = 'Found on the company contact page.';
  } else if (personAligned && assessment.matchesOfficialDomain) {
    reason = 'Named contact on the chosen company domain.';
  } else if (assessment.matchesOfficialDomain) {
    reason = 'Same domain as the chosen company.';
  } else if (assessment.freeMailbox && personAligned) {
    reason = 'Free mailbox, but the person name matches the permit.';
  }

  return {
    score: normalizedScore,
    aligned: entityAligned || assessment.freeMailbox,
    reason,
    assessment: {
      ...assessment,
      confidence: normalizedScore,
      score: normalizedScore,
      sendableAuto,
      sendableManual,
      researchOnly,
    },
    personAligned,
    companyAligned,
    breakdown: {
      score: normalizedScore,
      reason,
      positives,
      negatives,
      entityAligned,
      personAligned,
      companyAligned,
      domainHealthScore,
      domainReputationScore: reputation,
      provenance,
      assessment: {
        ...assessment,
        confidence: normalizedScore,
        score: normalizedScore,
        sendableAuto,
        sendableManual,
        researchOnly,
      },
      reverseVerification,
    },
  };
}

function buildPhoneTrust(contact, companyProfile = {}, permit = {}) {
  if (!contact?.phone) {
    return { score: 0, aligned: false, reason: 'No phone route exists.' };
  }

  const rolePriority = getRolePriority(contact.role || companyProfile.role || '');
  const personAligned = contactMatchesKnownPerson(contact, permit);
  const companyAligned = contactMatchesKnownCompany(contact, companyProfile, permit);
  let score = Math.round(contact.confidence || 0);
  score += 18;
  score += rolePriority;
  score += contact.source === 'google_maps' ? 14 : 0;
  score += personAligned ? 8 : 0;
  score += companyAligned ? 8 : 0;

  return {
    score: clamp(score, 0, 100),
    aligned: personAligned || companyAligned || contact.source === 'google_maps',
    reason:
      contact.source === 'google_maps'
        ? 'Phone came from the company Google Maps profile.'
        : personAligned
          ? 'Phone aligns with the named permit contact.'
          : 'Phone route looks tied to the chosen company.',
  };
}

function buildFormTrust(contact, companyProfile = {}) {
  const formDomain = rootDomain(contact?.contact_form_url || '');
  const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));
  const aligned = Boolean(formDomain && officialDomain && (formDomain === officialDomain || formDomain.endsWith(`.${officialDomain}`)));
  let score = Math.round(contact?.confidence || 0);
  score += 26;
  score += aligned ? 18 : -10;

  return {
    score: clamp(score, 0, 100),
    aligned,
    reason: aligned
      ? 'Contact form is on the chosen company website.'
      : 'Contact form exists, but it is not clearly tied to the chosen company site.',
  };
}

function buildLinkedInTrust(contact, companyProfile = {}, permit = {}) {
  const premiumFirm = isPremiumLinkedInTarget(companyProfile);
  const personAligned = contactMatchesKnownPerson(contact, permit);
  const companyAligned = contactMatchesKnownCompany(contact, companyProfile, permit);
  let score = Math.round(contact?.confidence || 0);
  score += premiumFirm ? 18 : 4;
  score += personAligned ? 12 : 0;
  score += companyAligned ? 8 : 0;

  return {
    score: clamp(score, 0, 100),
    aligned: premiumFirm || personAligned || companyAligned,
    reason: personAligned
      ? 'LinkedIn route points to the named permit contact.'
      : companyAligned
        ? 'LinkedIn route points to the chosen company.'
        : 'LinkedIn is only a light research path for this lead.',
  };
}

function isPremiumLinkedInTarget(companyProfile) {
  return METROGLASS_PROFILE.linkedinSignals.some((signal) =>
    normalizeText(companyProfile.normalized_name || companyProfile.company_name).includes(signal),
  );
}

function scoreEmailContactForSelection(contact, companyProfile = {}, permit = {}) {
  return buildEmailTrust(contact, companyProfile, permit).score;
}

function pickEmailContacts(contacts, companyProfile = {}, permit = {}) {
  const emailContacts = [...contacts]
    .filter((contact) => contact.email)
    .map((contact) => {
      const trust = buildEmailTrust(contact, companyProfile, permit);
      return {
        contact,
        trust,
        score: trust.score,
      };
    })
    .filter((entry) => entry.score >= MANUAL_SEND_EMAIL_SCORE_THRESHOLD && !entry.trust.assessment?.researchOnly)
    .sort((left, right) => {
      if (Boolean(right.contact.is_primary) !== Boolean(left.contact.is_primary)) {
        return Boolean(right.contact.is_primary) ? 1 : -1;
      }
      return right.score - left.score;
    });

  const explicitPrimary = emailContacts.find((entry) => entry.contact.is_primary);
  const primaryEntry =
    explicitPrimary
    || emailContacts.find((entry) => !isGenericMailbox(entry.contact.email))
    || emailContacts[0]
    || null;
  const fallbackEntry = emailContacts.find((entry) => {
    if (!primaryEntry || entry.contact.id === primaryEntry.contact.id) {
      return false;
    }

    return (
      isGenericMailbox(entry.contact.email)
      || emailDomain(entry.contact.email) !== emailDomain(primaryEntry.contact.email)
    );
  }) || null;

  return {
    primary: primaryEntry?.contact || null,
    fallback: fallbackEntry?.contact || null,
    ranked: emailContacts,
  };
}

function buildRouteCandidates({ companyProfile, contacts, permit }) {
  const premiumFirm = isPremiumLinkedInTarget(companyProfile);
  const candidates = [];

  contacts.forEach((contact) => {
    const role = contact.role || companyProfile.role || '';
    const rolePriority = getRolePriority(role);
    const confidence = Math.round(contact.confidence || 0);

    if (contact.email) {
      const emailTrust = buildEmailTrust(contact, companyProfile, permit);
      if (emailTrust.score <= 0 || !emailTrust.aligned || emailTrust.assessment?.researchOnly) {
        return;
      }

      let score = 34 + Math.round(rolePriority * 0.7) + Math.round(emailTrust.score * 0.58);
      score += contact.verified ? 8 : 0;
      score += contact.is_primary ? 18 : 0;

      candidates.push({
        channel: 'email',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: contact.type || 'public',
        routeSource: contact.source || '',
        routeTrustReason: emailTrust.reason,
        routeTrustScore: emailTrust.score,
      });
    }

    if (contact.phone) {
      const phoneTrust = buildPhoneTrust(contact, companyProfile, permit);
      const score = 18 + Math.round(rolePriority * 0.45) + Math.round(phoneTrust.score * 0.46) + (contact.is_primary ? 14 : 0);
      candidates.push({
        channel: 'phone',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
        routeTrustReason: phoneTrust.reason,
        routeTrustScore: phoneTrust.score,
      });
    }

    if (contact.contact_form_url) {
      const formTrust = buildFormTrust(contact, companyProfile);
      const score = 16 + Math.round(formTrust.score * 0.48) + Math.round((companyProfile.confidence || 0) * 0.08) + (contact.is_primary ? 12 : 0);
      candidates.push({
        channel: 'form',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
        routeTrustReason: formTrust.reason,
        routeTrustScore: formTrust.score,
      });
    }

    if (contact.linkedin_url) {
      const linkedinTrust = buildLinkedInTrust(contact, companyProfile, permit);
      const score = (premiumFirm ? 28 : 10) + Math.round(rolePriority * 0.3) + Math.round(linkedinTrust.score * 0.24) + (contact.is_primary ? 10 : 0);
      candidates.push({
        channel: 'linkedin',
        score: clamp(score, 0, 100),
        contact,
        targetRole: role || 'company',
        recipientType: 'public',
        routeSource: contact.source || '',
        routeTrustReason: linkedinTrust.reason,
        routeTrustScore: linkedinTrust.score,
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
      routeTrustReason: premiumFirm
        ? 'Premium architect or design profile with no clean email route yet.'
        : 'LinkedIn exists, but this is still a research fallback.',
      routeTrustScore: premiumFirm ? 56 : 32,
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
    return candidate.routeTrustReason || `A clean ${routeLabel} email route is available.`;
  }

  if (candidate.channel === 'phone') {
    return candidate.routeTrustReason || `A phone route exists for the ${routeLabel}, which is stronger than guessing another contact path.`;
  }

  if (candidate.channel === 'form') {
    return candidate.routeTrustReason || 'The official site has a contact route, so the form is cleaner than guessing another path.';
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
  const emailSelection = pickEmailContacts(contacts, companyProfile, permit);

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
      trustReason: 'No direct route is trustworthy yet.',
      suggestedCc: '',
      sendTrust: 0,
    };
  }

  const fallbackTrust = emailSelection.fallback
    ? buildEmailTrust(emailSelection.fallback, companyProfile, permit)
    : null;
  const suggestedCc =
    selected.channel === 'email'
    && emailSelection.fallback
    && (fallbackTrust?.score || 0) >= AUTO_SEND_EMAIL_SCORE_THRESHOLD
    && emailDomain(emailSelection.fallback.email || '') === emailDomain(selected.contact?.email || '')
      ? normalizeEmailAddress(emailSelection.fallback.email || '')
      : '';
  const manualAutoSendEligible =
    AUTO_SEND_ENABLED &&
    selected.channel === 'email' &&
    selected.recipientType !== 'guessed' &&
    (selected.routeTrustScore || selected.score) >= AUTO_SEND_EMAIL_SCORE_THRESHOLD &&
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
    trustReason: selected.routeTrustReason || '',
    suggestedCc,
    sendTrust: selected.routeTrustScore || selected.score,
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

  if (channelDecision.primary === 'email' && (channelDecision.sendTrust || 0) < AUTO_SEND_EMAIL_SCORE_THRESHOLD) {
    blockers.push('Primary email trust is still below the send threshold');
    readiness -= 10;
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

function resolveLeadStatus({ currentStatus, followUpDate, hasDraft, readinessLabel }) {
  if (currentStatus === 'archived') {
    return 'archived';
  }

  if (followUpDate) {
    return 'follow-up-due';
  }

  if (['contacted', 'replied', 'qualified', 'quoted', 'won', 'lost'].includes(currentStatus)) {
    return currentStatus;
  }

  if (hasDraft && ['new', 'reviewed', 'researching', 'outreach-ready', 'drafted'].includes(currentStatus || 'new')) {
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
      label:
        channelDecision.recipientType === 'guessed' || (channelDecision.sendTrust || 0) < AUTO_SEND_EMAIL_SCORE_THRESHOLD
          ? 'Review email first'
          : 'Email first',
      detail: channelDecision.trustReason || channelDecision.reason,
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
  const explicitPrimary = contacts.find((contact) => contact.is_primary);
  if (explicitPrimary) {
    return explicitPrimary;
  }

  const trustedEmailContact = pickEmailContacts(contacts, companyProfile, permit).primary;

  return trustedEmailContact
    || [...contacts]
      .filter((contact) => contact.phone)
      .sort((left, right) => buildPhoneTrust(right, companyProfile, permit).score - buildPhoneTrust(left, companyProfile, permit).score)[0]
    || [...contacts]
      .filter((contact) => contact.contact_form_url)
      .sort((left, right) => buildFormTrust(right, companyProfile).score - buildFormTrust(left, companyProfile).score)[0]
    || null;
}

function pickBestEmailContact(contacts, companyProfile = {}, permit = {}) {
  return pickEmailContacts(contacts, companyProfile, permit).primary;
}

function getAutoSendEmailContacts(contacts, companyProfile = {}, permit = {}) {
  const picked = pickEmailContacts(contacts, companyProfile, permit);
  const primaryTrust = picked.primary ? buildEmailTrust(picked.primary, companyProfile, permit) : null;
  if (!picked.primary || !primaryTrust?.assessment?.sendableAuto) {
    return [];
  }

  return [picked.primary];
}

function getManualSendEmailContacts(contacts, companyProfile = {}, permit = {}) {
  const picked = pickEmailContacts(contacts, companyProfile, permit);
  const manual = [];

  if (picked.primary) {
    const trust = buildEmailTrust(picked.primary, companyProfile, permit);
    if (trust.assessment?.sendableManual) {
      manual.push(picked.primary);
    }
  }

  if (picked.fallback) {
    const trust = buildEmailTrust(picked.fallback, companyProfile, permit);
    if (trust.assessment?.sendableManual) {
      manual.push(picked.fallback);
    }
  }

  return manual.slice(0, MANUAL_SEND_EMAIL_CONTACT_LIMIT);
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
  const permit = lead.raw_permit || lead;
  const emailSelection = pickEmailContacts(contacts, companyProfile, permit);
  const activeEmailRole = lead.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary';
  const activeEmailContact = activeEmailRole === 'fallback'
    ? emailSelection.fallback || emailSelection.primary
    : emailSelection.primary || emailSelection.fallback;
  const primaryContact = activeEmailContact || pickPrimaryContact(contacts, companyProfile, permit);
  const address = sanitizeOutreachCopy(lead.address);
  const projectAngle = getProjectAngle(lead);
  const relevanceScore = Number(lead.score_breakdown?.relevanceScore || lead.scoreBreakdown?.relevanceScore || 0.3);
  const relevanceKeyword = lead.score_breakdown?.relevanceKeyword || lead.scoreBreakdown?.relevanceKeyword || '';
  const pluginLine = sanitizeOutreachCopy(getPluginLine(`${lead.permit_key}:${lead.score}`));
  const role = getDraftRole(lead, companyProfile, primaryContact);
  const contactName = getDraftRecipientName(primaryContact, companyProfile, lead);
  const companyName = sanitizeOutreachCopy(companyProfile.company_name || lead.owner_business_name || lead.applicant_business_name || 'your team');
  const strategy = chooseDraftStrategy(lead, role, projectAngle, companyProfile, primaryContact);
  const introLine = sanitizeOutreachCopy(buildDraftIntro(lead, projectAngle, relevanceKeyword, role, strategy));
  const valueLine = sanitizeOutreachCopy(getDraftValueLine(role, projectAngle));
  const cta = sanitizeOutreachCopy(chooseDraftCta(lead, role, projectAngle, relevanceScore, strategy));
  const subject = sanitizeOutreachCopy(
    `${address}, ${projectAngle.includes('custom glass') ? 'glass scope' : projectAngle}`,
  );
  const body = [
    `Hi ${contactName},`,
    '',
    introLine,
    '',
    valueLine,
    '',
    cta,
    '',
    'Donald',
    'MetroGlass Pro',
    '332 999 3846',
  ]
    .map((line) => sanitizeOutreachCopy(line))
    .join('\n');

  const callOpener = sanitizeOutreachCopy(
    `Hi, this is Donald from MetroGlass Pro. I saw the permit at ${address} and wanted to check who is handling the ${projectAngle} on that job.`,
  );
  const followUpNote = sanitizeOutreachCopy(
    `I reached out about the permit at ${address}. If the ${projectAngle} is still open, I can send pricing or a quick takeoff.`,
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

function buildTrustScores({
  leadRow,
  companyProfile,
  propertyProfile,
  contacts,
  channelDecision,
}) {
  const permit = leadRow.raw_permit || {};
  const primaryContact = pickPrimaryContact(contacts, companyProfile, permit);
  const bestEmail = pickBestEmailContact(contacts, companyProfile, permit);
  const emailTrust = bestEmail ? buildEmailTrust(bestEmail, companyProfile, permit) : { score: 0, reason: 'No trusted email route yet.' };
  const mapsReviewCount = Number(companyProfile?.social_links?.google_reviews_count || 0);
  const mapsRating = Number(companyProfile?.social_links?.google_rating || 0);
  const personAligned = primaryContact ? contactMatchesKnownPerson(primaryContact, permit) : false;
  const companyTrustBase = Math.round(companyProfile.confidence || 0)
    + (companyProfile.website ? 10 : 0)
    + (companyProfile.domain ? 6 : 0)
    + (mapsRating >= 4 ? 6 : 0)
    + (mapsReviewCount >= 10 ? 6 : 0)
    + (companyProfile.match_strength === 'strong' ? 12 : companyProfile.match_strength === 'medium' ? 4 : -10);
  const propertyTrust = clamp(Math.round(propertyProfile.confidence || 0), 0, 100);
  const companyTrust = clamp(companyTrustBase, 0, 100);
  const personTrust = clamp(
    (primaryContact ? Math.round(primaryContact.confidence || 0) : 0)
      + (personAligned ? 18 : 0)
      + (primaryContact?.linkedin_url ? 8 : 0)
      + (primaryContact?.name ? 4 : 0),
    0,
    100,
  );
  const channelTrust = clamp(Math.round(channelDecision.sendTrust || channelDecision.routeConfidence || 0), 0, 100);
  const sendTrust = clamp(
    Math.round((companyTrust * 0.28) + (propertyTrust * 0.12) + (personTrust * 0.2) + (emailTrust.score * 0.22) + (channelTrust * 0.18)),
    0,
    100,
  );

  const needsWork = [];
  if (companyTrust < 65) needsWork.push('Company match still needs stronger evidence.');
  if (personTrust < 55) needsWork.push('Decision maker match is still light.');
  if (emailTrust.score < AUTO_SEND_EMAIL_SCORE_THRESHOLD) needsWork.push('Email trust is still below the send threshold.');
  if (channelDecision.primary !== 'email') needsWork.push('Best route is not email yet.');

  return {
    company: companyTrust,
    property: propertyTrust,
    person: personTrust,
    email: emailTrust.score,
    channel: channelTrust,
    send: sendTrust,
    primaryEmailReason: emailTrust.reason,
    needsWork,
  };
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
  let channelDecision = buildChannelDecision({
    score: leadRow.score,
    contactability,
    companyProfile,
    contacts,
    permit,
  });
  const emailSelection = pickEmailContacts(contacts, companyProfile, permit);
  if (leadRow.enrichment_summary?.emailStrategy?.activeEmailRole === 'fallback' && emailSelection.fallback) {
    const fallbackTrust = buildEmailTrust(emailSelection.fallback, companyProfile, permit);
    channelDecision = {
      ...channelDecision,
      primary: 'email',
      reason: fallbackTrust.reason || channelDecision.reason,
      routeConfidence: fallbackTrust.score,
      recipientType: emailSelection.fallback.type || 'public',
      targetRole: emailSelection.fallback.role || companyProfile.role || 'company',
      routeSource: emailSelection.fallback.source || '',
      trustReason: fallbackTrust.reason || '',
      sendTrust: fallbackTrust.score,
      primaryEmail: emailSelection.fallback.email || '',
      fallbackEmail: emailSelection.primary?.email || '',
      primaryEmailTrust: fallbackTrust.score,
      fallbackEmailTrust: emailSelection.primary ? buildEmailTrust(emailSelection.primary, companyProfile, permit).score : 0,
      activeEmailRole: 'fallback',
      autoSendEligible: Boolean(fallbackTrust.assessment?.sendableAuto),
    };
  }
  const readiness = buildOutreachReadiness(leadRow.score, contactability, companyProfile, contacts, channelDecision);
  const qualityTier = buildQualityTier({ leadRow, contactability, companyProfile, contacts });
  const { priorityLabel, priorityScore } = buildPriorityState(leadRow.score, contactability, readiness);
  const followUpDate = leadRow.enrichment_summary?.manualEnrichment?.followUpDate || '';
  const status = resolveLeadStatus({
    currentStatus: leadRow.status,
    followUpDate,
    hasDraft: promoteDrafted,
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
  const trustScores = buildTrustScores({
    leadRow,
    companyProfile,
    propertyProfile,
    contacts,
    channelDecision,
  });
  const autoSendContacts = getAutoSendEmailContacts(contacts, companyProfile, permit);
  const autoSendEligible =
    AUTO_SEND_ENABLED &&
    autoSendContacts.length > 0 &&
    readiness.label !== 'Blocked' &&
    qualityTier !== 'dead' &&
    channelDecision.primary === 'email' &&
    trustScores.send >= AUTO_SEND_EMAIL_SCORE_THRESHOLD;

  return {
    contactability,
    channelDecision: {
      ...channelDecision,
      autoSendEligible,
      primaryEmail: emailSelection.primary?.email || '',
      fallbackEmail: emailSelection.fallback?.email || '',
      primaryEmailTrust: emailSelection.primary ? buildEmailTrust(emailSelection.primary, companyProfile, permit).score : 0,
      fallbackEmailTrust: emailSelection.fallback ? buildEmailTrust(emailSelection.fallback, companyProfile, permit).score : 0,
      activeEmailRole: leadRow.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary',
    },
    readiness,
    qualityTier,
    priorityLabel,
    priorityScore,
    status,
    nextAction,
    enrichmentConfidence: Math.round(((companyProfile.confidence || 0) * 0.35) + ((propertyProfile.confidence || 0) * 0.2) + (readiness.score * 0.2) + (trustScores.send * 0.25)),
    trustScores,
    autoSendEligible,
    autoSendReason: qualityTier === 'dead'
      ? 'Permit relevance is too weak for active outreach.'
      : AUTO_SEND_ENABLED
      ? autoSendEligible
        ? `${autoSendContacts.length} strong email route${autoSendContacts.length > 1 ? 's are' : ' is'} ready for automatic sending.`
        : trustScores.needsWork[0] || 'No strong email route has cleared the automatic send threshold yet.'
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
      lowRelevance: scoreBreakdown.relevanceScore >= MIN_RELEVANCE_THRESHOLD && scoreBreakdown.relevanceScore < 0.4,
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

function buildGoogleMapsPlaceUrl(placeId, fallbackQuery = '') {
  if (placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }

  if (fallbackQuery) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
  }

  return '';
}

function scoreGoogleBusinessCandidate(result, companyName, permit, role = 'owner') {
  const seed = stripCompanySuffix(companyName);
  const companyTokens = tokenizeName(companyName);
  const businessName = stripCompanySuffix(result.name || '');
  const address = normalizeText(result.formatted_address || '');
  const typesBlob = normalizeText((result.types || []).join(' '));
  const streetTokens = tokenizeName(permit.street_name || '');
  const borough = normalizeText(permit.borough || '');
  const zipCode = normalizeText(permit.zip_code || '');

  let score = 18;
  const tokenMatches = countTokenMatches(companyTokens, businessName);
  score += tokenMatches * 16;

  if (seed && businessName.includes(seed)) {
    score += 30;
  }

  if (tokenMatches === 0) {
    score -= 26;
  }

  score += countTokenMatches(streetTokens, address) * 6;
  if (borough && address.includes(borough)) {
    score += 8;
  }
  if (zipCode && address.includes(zipCode)) {
    score += 8;
  }

  if (normalizeText(result.business_status || '') === 'operational') {
    score += 6;
  }

  const rating = Number(result.rating || 0);
  const reviewCount = Number(result.user_ratings_total || 0);
  if (rating >= 4.5) {
    score += 6;
  } else if (rating >= 4.0) {
    score += 3;
  }
  if (reviewCount >= 25) {
    score += 6;
  } else if (reviewCount >= 8) {
    score += 3;
  }

  if (role.includes('architect') || role.includes('design')) {
    if (typesBlob.includes('architect') || typesBlob.includes('interior_designer')) {
      score += 12;
    }
  } else if (typesBlob.includes('general_contractor') || typesBlob.includes('construction_company')) {
    score += 12;
  }

  return score;
}

function summarizeGoogleReviewSignals(reviews = [], permit = {}) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      summary: '',
      highlights: [],
      matchedKeywords: [],
    };
  }

  const keywords = uniq([
    ...buildProjectTags(permit),
    'glass',
    'mirror',
    'shower',
    'partition',
    'storefront',
    'office',
    'bathroom',
    'renovation',
    'architect',
    'contractor',
  ]);
  const reviewBlob = normalizeText(reviews.map((review) => review.text || '').join(' '));
  const matchedKeywords = keywords.filter((keyword) => reviewBlob.includes(normalizeText(keyword))).slice(0, 4);
  const highlights = reviews
    .map((review) => sanitizeOutreachCopy((review.text || '').replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => text.slice(0, 160));

  const summary = matchedKeywords.length > 0
    ? `Google reviews mention ${matchedKeywords.join(', ')}.`
    : highlights[0] || '';

  return {
    summary,
    highlights,
    matchedKeywords,
  };
}

async function fetchGooglePlaceDetails(env, placeId) {
  if (!env.GOOGLE_MAPS_API_KEY || !placeId) {
    return null;
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'place_id,name,website,url,formatted_phone_number,international_phone_number,rating,user_ratings_total,business_status,reviews,types,formatted_address',
    key: env.GOOGLE_MAPS_API_KEY,
  });
  const payload = await fetchJson(`${API_ENDPOINTS.googlePlaceDetails}?${params.toString()}`);
  return payload.result || null;
}

async function searchGoogleBusinessProfile(env, permit, companyProfile, options = {}) {
  const companyName =
    companyProfile.company_name ||
    permit.applicant_business_name ||
    permit.filing_representative_business_name ||
    permit.owner_business_name ||
    '';

  if (!env.GOOGLE_MAPS_API_KEY || !companyName) {
    return null;
  }

  const role = companyProfile.role || 'owner';
  const queries = uniq([
    `${companyName} ${getPermitAddress(permit)}`,
    `${companyName} ${permit.borough || ''} NY`,
    options.force ? `${companyName} NYC` : '',
  ]).filter(Boolean);

  try {
    const resultSets = await Promise.all(
      queries.map(async (query) => {
        const params = new URLSearchParams({
          query,
          region: 'us',
          key: env.GOOGLE_MAPS_API_KEY,
        });
        const payload = await fetchJson(`${API_ENDPOINTS.googlePlacesTextSearch}?${params.toString()}`);
        return {
          query,
          results: payload.results || [],
        };
      }),
    );

    const candidateByPlaceId = new Map();
    resultSets.forEach((resultSet) => {
      resultSet.results.forEach((result) => {
        const placeId = result.place_id || result.name || result.formatted_address || '';
        if (!placeId) {
          return;
        }

        const score = scoreGoogleBusinessCandidate(result, companyName, permit, role);
        const existing = candidateByPlaceId.get(placeId);
        if (!existing || score > existing.score) {
          candidateByPlaceId.set(placeId, {
            query: resultSet.query,
            result,
            score,
          });
        }
      });
    });

    const rankedCandidates = [...candidateByPlaceId.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, options.force ? 5 : 3);

    const winningCandidate = rankedCandidates[0] || null;
    const strongEnough = Boolean(winningCandidate && winningCandidate.score >= 44);
    const details = strongEnough
      ? await fetchGooglePlaceDetails(env, winningCandidate.result.place_id)
      : null;
    const reviewSignals = summarizeGoogleReviewSignals(details?.reviews || [], permit);
    const website = originFromUrl(details?.website || '');
    const domain = rootDomain(website);
    const confidence = strongEnough ? clamp((winningCandidate?.score || 0) + (reviewSignals.matchedKeywords.length * 3), 28, 97) : 0;
    const selectedPlaceId = details?.place_id || (strongEnough ? winningCandidate?.result.place_id : '');

    return {
      selected: Boolean(selectedPlaceId),
      companyName: details?.name || winningCandidate?.result.name || companyName,
      role,
      placeId: selectedPlaceId || '',
      mapsUrl: details?.url || buildGoogleMapsPlaceUrl(selectedPlaceId || winningCandidate?.result.place_id, companyName),
      website,
      domain,
      phone: details?.formatted_phone_number || details?.international_phone_number || '',
      rating: Number(details?.rating || winningCandidate?.result.rating || 0),
      reviewCount: Number(details?.user_ratings_total || winningCandidate?.result.user_ratings_total || 0),
      businessStatus: normalizeText(details?.business_status || winningCandidate?.result.business_status || ''),
      reviewSummary: reviewSignals.summary,
      reviewHighlights: reviewSignals.highlights,
      reviewKeywords: reviewSignals.matchedKeywords,
      confidence,
      candidates: rankedCandidates.map((candidate, index) =>
        buildResolutionCandidate({
          type: 'company',
          role,
          label: candidate.result.name || companyName,
          url: buildGoogleMapsPlaceUrl(candidate.result.place_id, candidate.result.name || companyName),
          domain: rootDomain(candidate.result.website || ''),
          source: 'google_maps',
          confidence: clamp(candidate.score, 18, 96),
          status:
            strongEnough && candidate.result.place_id === selectedPlaceId
              ? 'selected'
              : index === 0 && !strongEnough
                ? 'candidate'
                : 'rejected',
          detail: [
            candidate.result.formatted_address || '',
            candidate.result.rating ? `${candidate.result.rating} stars` : '',
            candidate.result.user_ratings_total ? `${candidate.result.user_ratings_total} reviews` : '',
          ].filter(Boolean).join(' | '),
          matchedQuery: candidate.query,
        }),
      ),
    };
  } catch {
    return null;
  }
}

function mergeCompanyWithGoogleBusiness(companyProfile, googleBusinessProfile) {
  if (!googleBusinessProfile?.selected) {
    return companyProfile;
  }

  const currentDomain = normalizeText(companyProfile.domain || rootDomain(companyProfile.website || ''));
  const mapsDomain = normalizeText(googleBusinessProfile.domain || '');
  const currentConfidence = Number(companyProfile.confidence || 0);
  const mapsConfidence = Number(googleBusinessProfile.confidence || 0);
  const shouldUseMapsWebsite =
    Boolean(mapsDomain) &&
    (
      !currentDomain ||
      isDirectoryDomain(currentDomain) ||
      mapsDomain === currentDomain ||
      mapsConfidence >= currentConfidence + 4
    );
  const nextWebsite = shouldUseMapsWebsite ? googleBusinessProfile.website : companyProfile.website;
  const nextDomain = shouldUseMapsWebsite ? mapsDomain : companyProfile.domain;
  const nextConfidence = clamp(Math.max(currentConfidence, mapsConfidence), 0, 98);

  return {
    ...companyProfile,
    company_name: googleBusinessProfile.companyName || companyProfile.company_name,
    normalized_name: normalizeText(googleBusinessProfile.companyName || companyProfile.company_name),
    website: nextWebsite || companyProfile.website || '',
    domain: nextDomain || companyProfile.domain || '',
    confidence: nextConfidence,
    description: companyProfile.description || googleBusinessProfile.reviewSummary || '',
    social_links: {
      ...(companyProfile.social_links || {}),
      google_maps_url: googleBusinessProfile.mapsUrl || '',
      google_place_id: googleBusinessProfile.placeId || '',
      google_rating: googleBusinessProfile.rating || 0,
      google_reviews_count: googleBusinessProfile.reviewCount || 0,
    },
    match_strength: nextConfidence >= 76 ? 'strong' : nextConfidence >= 52 ? 'medium' : 'weak',
  };
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

async function reverseVerifyPerson(env, gateway, personName, companyName) {
  const normalizedPerson = (personName || '').trim();
  const normalizedCompany = (companyName || '').trim();
  if (!normalizedPerson || !normalizedCompany || !env.BRAVE_API_KEY) {
    return {
      verified: false,
      confidence: 0,
      signals: [],
      search_results_summary: '',
    };
  }

  const cached = await gateway.getPersonVerification(normalizedPerson, normalizedCompany);
  if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) {
    return cached;
  }

  const results = mapSearchResults(
    await runBraveSearch(env, `"${normalizedPerson}" "${normalizedCompany}" LinkedIn`),
  ).slice(0, 5);

  const personTokens = tokenizeName(normalizedPerson);
  const companyTokens = tokenizeName(normalizedCompany);
  const strongMatch = results.find((result) => {
    const searchable = normalizeText([result.title, result.description, result.url].filter(Boolean).join(' '));
    return countTokenMatches(personTokens, searchable) > 0 && countTokenMatches(companyTokens, searchable) > 0;
  });
  const negativeMatch = results.find((result) => {
    const searchable = normalizeText([result.title, result.description, result.url].filter(Boolean).join(' '));
    return countTokenMatches(personTokens, searchable) > 0
      && countTokenMatches(companyTokens, searchable) === 0
      && (searchable.includes('linkedin') || searchable.includes('former'));
  });

  const signals = [];
  let confidence = 0.2;
  let verified = false;

  if (strongMatch) {
    verified = true;
    confidence = 0.9;
    signals.push(`Search result ties ${normalizedPerson} to ${normalizedCompany}`);
  } else if (negativeMatch) {
    verified = false;
    confidence = 0;
    signals.push(`Search suggests ${normalizedPerson} is tied to a different company`);
  } else if (results.length > 0) {
    confidence = 0.5;
    signals.push(`Search found ${results.length} related result${results.length > 1 ? 's' : ''}, but none were conclusive`);
  } else {
    signals.push('No search results tied the person to the company');
  }

  const summary = results
    .slice(0, 2)
    .map((result) => [result.title, result.description].filter(Boolean).join(' — '))
    .join(' | ');

  const record = {
    id: cached?.id || createId(),
    person_name: normalizedPerson,
    company_name: normalizedCompany,
    verified,
    confidence,
    signals,
    search_results_summary: summary,
    checked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (PERSON_VERIFICATION_CACHE_DAYS * 86400000)).toISOString(),
  };

  await gateway.upsertPersonVerification(record);
  return record;
}

async function scrapeWebsiteSignals(env, leadScore, website, options = {}) {
  if (!env.FIRECRAWL_API_KEY || !website || (!options.force && leadScore < HIGH_VALUE_SCORE)) {
    return null;
  }

  const urls = uniq([
    website,
    website.replace(/\/$/, '') + '/contact',
  ]).slice(0, options.force ? 2 : 1);

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
        const markdown = payload?.data?.markdown || '';
        return {
          url,
          markdown,
          text: markdown,
          pageType: detectPageType(url, markdown),
          staleness: checkPageStaleness({
            url,
            markdown,
            text: markdown,
          }),
        };
      }),
    );

    const validPages = pages.filter(Boolean);
    const combined = validPages.map((page) => page.markdown).join('\n');
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

    const emailCandidates = validPages.flatMap((page) =>
      extractEmails(page.markdown).map((email) => ({
        email,
        provenance: buildEmailProvenance({
          source: 'firecrawl',
          url: page.url,
          pageType: page.pageType,
          extractionMethod: detectExtractionMethod(page.markdown, email),
          foundAt: new Date().toISOString(),
          rawContext: extractTextSnippet(page.markdown, email),
          staleness: page.staleness,
        }),
      })),
    );

    return {
      emailCandidates,
      emails: emailCandidates.map((entry) => entry.email),
      phones: extractPhones(combined),
      socialLinks,
      serviceText: combined.slice(0, 1400),
      pages: validPages,
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

function mergeStoredEmailCandidateMeta(contacts, leadRow = {}) {
  const metadata = Array.isArray(leadRow.enrichment_summary?.emailCandidates)
    ? leadRow.enrichment_summary.emailCandidates
    : [];
  if (metadata.length === 0) {
    return contacts;
  }

  const metaByEmail = new Map(
    metadata.map((entry) => [normalizeEmailAddress(entry.email || ''), entry]),
  );

  return contacts.map((contact) => {
    const match = metaByEmail.get(normalizeEmailAddress(contact.email || ''));
    return match
      ? {
          ...contact,
          provenance: match.provenance || contact.provenance,
          trust_score: Number(match.trustScore || contact.trust_score || 0),
          trust_breakdown: match.trustBreakdown || contact.trust_breakdown,
          person_verification: match.personVerification || contact.person_verification,
        }
      : contact;
  });
}

async function hydrateEmailTrustForContacts(env, gateway, contacts, companyProfile, permit, options = {}) {
  const domainHealthCache = new Map();
  const reputationCache = new Map();
  const prioritizedDomains = [];
  const officialDomain = normalizeText(companyProfile?.domain || rootDomain(companyProfile?.website || ''));

  if (officialDomain) {
    prioritizedDomains.push(officialDomain);
  }

  contacts
    .filter((contact) => contact.email)
    .sort((left, right) => {
      const leftEmail = normalizeEmailAddress(left.email || '');
      const rightEmail = normalizeEmailAddress(right.email || '');
      const leftDomain = emailDomain(leftEmail);
      const rightDomain = emailDomain(rightEmail);
      const leftOfficial = leftDomain === officialDomain ? 1 : 0;
      const rightOfficial = rightDomain === officialDomain ? 1 : 0;
      const leftManual = left.source === 'manual' ? 1 : 0;
      const rightManual = right.source === 'manual' ? 1 : 0;
      return (rightOfficial - leftOfficial) || (rightManual - leftManual) || ((right.confidence || 0) - (left.confidence || 0));
    })
    .forEach((contact) => {
      const domain = emailDomain(contact.email || '');
      if (domain && !prioritizedDomains.includes(domain) && prioritizedDomains.length < 3) {
        prioritizedDomains.push(domain);
      }
    });

  for (const contact of contacts) {
    if (!contact.email) {
      continue;
    }

    const domain = emailDomain(contact.email);
    let domainHealth = domainHealthCache.get(domain);
    if (!domainHealth) {
      domainHealth = prioritizedDomains.includes(domain)
        ? await checkDomainHealth(env, gateway, domain)
        : {
            domain,
            has_mx: true,
            has_website: false,
            is_parked: false,
            mx_records: [],
            health_score: 50,
            checked_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + (DOMAIN_HEALTH_CACHE_DAYS * 86400000)).toISOString(),
          };
      domainHealthCache.set(domain, domainHealth);
    }

    let domainReputation = reputationCache.get(domain);
    if (!domainReputation) {
      domainReputation = await getDomainReputationSnapshot(gateway, domain);
      reputationCache.set(domain, domainReputation);
    }

    contact.provenance = {
      ...(contact.provenance || {}),
      source: contact.provenance?.source || contact.source || 'unknown',
      page_type: contact.provenance?.page_type || 'unknown',
      extraction_method: contact.provenance?.extraction_method || (contact.source === 'pattern_guess' ? 'pattern_guess' : 'text_scrape'),
      found_at: contact.provenance?.found_at || new Date().toISOString(),
      raw_context: contact.provenance?.raw_context || '',
      domain_health: domainHealth,
      staleness: contact.provenance?.staleness || undefined,
    };
    contact.domain_reputation_score = Number(domainReputation?.reputation_score || 50);
  }

  const picked = pickEmailContacts(contacts, companyProfile, permit);
  const candidatesToVerify = [picked.primary, picked.fallback].filter(Boolean);

  if (options.deepVerify === true) {
    for (const contact of candidatesToVerify) {
      const initialTrust = buildEmailTrust(contact, companyProfile, permit);
      if (
        initialTrust.score >= AUTO_SEND_EMAIL_SCORE_THRESHOLD
        && contact.name
        && !isGenericMailbox(contact.email)
      ) {
        contact.person_verification = await reverseVerifyPerson(
          env,
          gateway,
          contact.name,
          companyProfile.company_name || permit.applicant_business_name || permit.owner_business_name || '',
        );
      }
    }
  }

  contacts.forEach((contact) => {
    if (!contact.email) {
      return;
    }

    const trust = buildEmailTrust(contact, companyProfile, permit);
    contact.trust_score = trust.score;
    contact.trust_breakdown = trust.breakdown || {};
    contact.confidence = Math.max(Math.round(contact.confidence || 0), trust.score);
  });

  return contacts;
}

async function enrichLead(env, gateway, leadRow, options = {}) {
  const permit = leadRow.raw_permit || {};
  const [geo, pluto, hpd, companySearch] = await Promise.all([
    geocodeAddress(env, leadRow.address),
    fetchPlutoProfile(permit),
    fetchHpdSummary(permit),
    searchCompanyDomain(env, permit, leadRow.score, options),
  ]);
  const { candidates: companyCandidates = [], ...resolvedCompany } = companySearch;
  const googleBusinessProfile = await searchGoogleBusinessProfile(env, permit, resolvedCompany, options);
  const company = mergeCompanyWithGoogleBusiness(resolvedCompany, googleBusinessProfile);
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
  const resolutionCandidates = [...companyCandidates, ...(googleBusinessProfile?.candidates || [])];
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
    google_maps_url: company.social_links?.google_maps_url || googleBusinessProfile?.mapsUrl || '',
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

  if (socialLinks.google_maps_url) {
    facts.push({
      id: createId('fact'),
      field: 'google_maps_profile',
      value: socialLinks.google_maps_url,
      source: 'google_maps',
      confidence: Math.max(company.confidence - 4, 58),
      metadata: {
        placeId: company.social_links?.google_place_id || googleBusinessProfile?.placeId || '',
      },
    });
  }

  if ((googleBusinessProfile?.rating || 0) > 0) {
    facts.push({
      id: createId('fact'),
      field: 'google_maps_rating',
      value: `${googleBusinessProfile.rating} stars from ${googleBusinessProfile.reviewCount || 0} reviews`,
      source: 'google_maps',
      confidence: Math.max(company.confidence - 6, 56),
      metadata: {
        rating: googleBusinessProfile.rating,
        reviewCount: googleBusinessProfile.reviewCount || 0,
        businessStatus: googleBusinessProfile.businessStatus || '',
      },
    });
  }

  if (googleBusinessProfile?.reviewSummary) {
    facts.push({
      id: createId('fact'),
      field: 'google_review_signal',
      value: googleBusinessProfile.reviewSummary,
      source: 'google_maps',
      confidence: Math.max(company.confidence - 8, 54),
      metadata: {
        highlights: googleBusinessProfile.reviewHighlights || [],
        keywords: googleBusinessProfile.reviewKeywords || [],
      },
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

  if (googleBusinessProfile?.phone) {
    contacts.push({
      id: createId('contact'),
      name: company.company_name || permit.owner_name || getApplicantName(permit) || '',
      role: company.role || 'owner',
      email: '',
      phone: googleBusinessProfile.phone,
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: Math.max(84, Math.round(googleBusinessProfile.confidence || 0)),
      source: 'google_maps',
      verified: false,
      is_primary: !contacts.some((contact) => contact.email),
    });
  }

  (websiteSignals?.emailCandidates || []).forEach((entry, index) => {
    const email = entry.email;
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
      confidence: 0,
      source: 'firecrawl',
      verified: false,
      is_primary: index === 0,
      provenance: entry.provenance || buildEmailProvenance({
        source: 'firecrawl',
        url: company.website || '',
        pageType: 'unknown',
        extractionMethod: 'text_scrape',
        rawContext: '',
        foundAt: new Date().toISOString(),
      }),
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
      confidence: 0,
      source: 'pattern_guess',
      verified: false,
      is_primary: !contacts.some((contact) => contact.email) && index === 0,
      provenance: buildEmailProvenance({
        source: 'pattern_guess',
        url: company.website || searchSignals.website || '',
        pageType: 'unknown',
        extractionMethod: 'pattern_guess',
        rawContext: `Pattern guessed from ${company.domain || rootDomain(company.website || '')}`,
        foundAt: new Date().toISOString(),
      }),
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
  await hydrateEmailTrustForContacts(env, gateway, dedupedContacts, company, permit);
  const emailSelection = pickEmailContacts(dedupedContacts, company, permit);
  const primaryContact = pickPrimaryContact(dedupedContacts, company, permit) || null;
  dedupedContacts.forEach((contact) => {
    contact.is_primary = Boolean(primaryContact && contact.id === primaryContact.id);
  });

  const primaryEmailCandidate = emailSelection.primary?.email || '';
  const fallbackEmailCandidate = emailSelection.fallback?.email || '';
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
      trustScores: derivedState.trustScores,
      emailStrategy: {
        primaryEmail: primaryEmailCandidate,
        fallbackEmail: fallbackEmailCandidate,
        primaryEmailTrust: emailSelection.primary ? buildEmailTrust(emailSelection.primary, company, permit).score : 0,
        fallbackEmailTrust: emailSelection.fallback ? buildEmailTrust(emailSelection.fallback, company, permit).score : 0,
        activeEmailRole: leadRow.primary_bounced_at ? 'fallback' : 'primary',
        operatorVouched: Boolean(leadRow.operator_vouched || leadRow.enrichment_summary?.operatorVouched),
        emailVerifiedBy: leadRow.email_verified_by || leadRow.enrichment_summary?.emailVerifiedBy || '',
      },
      emailCandidates: dedupedContacts
        .filter((contact) => contact.email)
        .map((contact) => ({
          id: contact.id,
          email: contact.email,
          name: contact.name || '',
          role: contact.role || '',
          type: contact.type || 'public',
          source: contact.source || '',
          trustScore: Number(contact.trust_score || 0),
          trustBreakdown: contact.trust_breakdown || {},
          provenance: contact.provenance || {},
          personVerification: contact.person_verification || null,
          isPrimary: Boolean(contact.is_primary),
        })),
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
        trustScores: derivedState.trustScores,
        routeTrustReason: derivedState.channelDecision.trustReason || '',
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
        trustReason: derivedState.channelDecision.trustReason || '',
        sendTrust: derivedState.trustScores.send,
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

  const companyProfile = lead.enrichment_summary?.company || {};
  const permit = lead.raw_permit || lead;
  const emailSelection = pickEmailContacts(contacts, companyProfile, permit);
  const activeRole = lead.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary';
  const activeContact = activeRole === 'fallback'
    ? emailSelection.fallback || emailSelection.primary
    : emailSelection.primary || emailSelection.fallback;
  const activeTrust = activeContact ? buildEmailTrust(activeContact, companyProfile, permit) : null;

  if (!activeContact || !activeTrust?.assessment?.sendableAuto) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'No strong email route is available for auto-send.',
      status: 'needs review',
    });
    return { sent: false, reason: 'No email contact' };
  }

  const duplicateSince = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  if (sentToday >= sendLimits.perDay || sentThisHour >= sendLimits.perHour) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'Throttle limit reached.',
      status: 'needs review',
    });
    return { sent: false, reason: 'Throttle limit reached' };
  }

  const isDuplicate = await gateway.hasDuplicateOutreach(activeContact.email, duplicateSince);
  if (isDuplicate) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'Duplicate within 30 days.',
      status: 'needs review',
    });
    return { sent: false, reason: 'Duplicate within 30 days' };
  }

  const gmailResult = await sendAutomationEmail(env, {
    recipient: activeContact.email,
    subject: outreachDraft.subject,
    body: outreachDraft.draft,
  });
  const sentAt = new Date().toISOString();
  await gateway.patch('outreach', [eq('id', outreachDraft.id)], {
    status: 'sent',
    sent_at: sentAt,
    gmail_message_id: gmailResult.id || '',
    gmail_thread_id: gmailResult.threadId || '',
    recipient: activeContact.email,
    recipient_type: activeContact.type,
    metadata: {
      ...(outreachDraft.metadata || {}),
      autoSend: true,
      activeEmailRole: activeRole,
    },
  });
  await recordEmailOutcome(gateway, {
    leadId: lead.id,
    email: activeContact.email,
    outcome: 'unknown',
    sentAt,
  });

  await Promise.all([
    gateway.patch('leads', [eq('id', lead.id)], {
      status: 'contacted',
      last_contacted_at: sentAt,
      last_sent_at: sentAt,
      duplicate_guard_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
      auto_send_reason: `Email sent automatically to the ${activeRole} contact.`,
    }),
    gateway.insert('activity_log', {
      id: createId('activity'),
      lead_id: lead.id,
      event_type: 'email_sent',
      summary: 'Email sent automatically',
      detail: `Sent to ${activeContact.email}`,
      metadata: {
        outreachId: outreachDraft.id,
        recipients: [activeContact.email],
        activeEmailRole: activeRole,
      },
    }),
  ]);

  return {
    sent: true,
    count: 1,
    recipient: activeContact.email || '',
    recipients: [activeContact.email],
    outreachId: outreachDraft.id,
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

  const leads = snapshot.leads.map((lead) => {
    const permit = lead.raw_permit || {};
    const company = companyMap.get(lead.id) || {};
    const property = propertyMap.get(lead.id) || {};
    const contacts = contactsMap.get(lead.id) || [];
    const emailCandidateMeta = new Map(
      ((lead.enrichment_summary?.emailCandidates || []).filter(Boolean)).map((entry) => [normalizeEmailAddress(entry.email || ''), entry]),
    );
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
          lead.enrichment_summary?.emailStrategy?.primaryEmail ||
          contacts.find((contact) => contact.email && Boolean(emailCandidateMeta.get(normalizeEmailAddress(contact.email || ''))?.trustScore >= AUTO_SEND_EMAIL_SCORE_THRESHOLD))?.email ||
          '',
        genericEmail:
          manualEnrichment.genericEmail ||
          lead.enrichment_summary?.emailStrategy?.fallbackEmail ||
          contacts.find((contact) => contact.email && isGenericMailbox(contact.email || ''))?.email ||
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
        primaryEmail: lead.enrichment_summary?.emailStrategy?.primaryEmail || '',
        fallbackEmail: lead.enrichment_summary?.emailStrategy?.fallbackEmail || '',
        primaryEmailTrust: Number(lead.enrichment_summary?.emailStrategy?.primaryEmailTrust || 0),
        fallbackEmailTrust: Number(lead.enrichment_summary?.emailStrategy?.fallbackEmailTrust || 0),
        activeEmailRole: lead.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary',
        operatorVouched: Boolean(lead.enrichment_summary?.emailStrategy?.operatorVouched),
        emailVerifiedBy: lead.enrichment_summary?.emailStrategy?.emailVerifiedBy || '',
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
        ...(emailCandidateMeta.get(normalizeEmailAddress(contact.email || '')) || {}),
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
        trustReason: channelDecision.trustReason || '',
        suggestedCc: channelDecision.suggestedCc || '',
        sendTrust: Number(channelDecision.sendTrust || 0),
        primaryEmail: lead.enrichment_summary?.emailStrategy?.primaryEmail || '',
        fallbackEmail: lead.enrichment_summary?.emailStrategy?.fallbackEmail || '',
        primaryEmailTrust: Number(lead.enrichment_summary?.emailStrategy?.primaryEmailTrust || 0),
        fallbackEmailTrust: Number(lead.enrichment_summary?.emailStrategy?.fallbackEmailTrust || 0),
        activeEmailRole: lead.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary',
      },
      outreachHistory,
      automationSummary: {
        companyMatchStrength: lead.company_match_strength || 'weak',
        enrichmentConfidence: lead.enrichment_confidence || 0,
        autoSendEligible: Boolean(lead.auto_send_eligible),
        autoSendReason: lead.auto_send_reason || '',
        lastAutomationRunAt: lead.last_enriched_at || lead.updated_at,
        operatorVouched: Boolean(lead.enrichment_summary?.emailStrategy?.operatorVouched),
        emailVerifiedBy: lead.enrichment_summary?.emailStrategy?.emailVerifiedBy || '',
        activeEmailRole: lead.enrichment_summary?.emailStrategy?.activeEmailRole || 'primary',
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
    jobs: (snapshot.jobs || []).map((job) => ({
      id: job.id,
      leadId: job.lead_id || null,
      jobType: job.job_type,
      status: job.status,
      provider: job.provider || 'worker',
      summary: job.summary || '',
      detail: job.detail || '',
      attemptCount: job.attempt_count || 1,
      retryable: Boolean(job.retryable),
      createdAt: job.created_at,
      startedAt: job.started_at || null,
      finishedAt: job.finished_at || null,
      metadata: job.metadata || {},
    })),
  };
}

function normalizeStatusForUi(status) {
  switch (status) {
    case 'needs review':
      return 'reviewed';
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
  const ingestResult = await runPermitIngestInternal(env, gateway);
  const enrichmentResult = await runEnrichmentBatchInternal(env, gateway, ingestResult.leads, {
    limit: Math.max(ENRICHMENT_BATCH_LIMIT, Math.min(ingestResult.leads?.length || ENRICHMENT_BATCH_LIMIT, 6)),
  });

  return {
    scanned: ingestResult.scanned,
    ingested: ingestResult.ingested,
    enriched: enrichmentResult.enriched,
    sent: enrichmentResult.sent,
    generatedDrafts: enrichmentResult.enriched,
  };
}

function needsAutomationPass(lead) {
  if (isAutomationTerminalStatus(lead.status)) {
    return false;
  }

  const relevanceScore = Number(lead.score_breakdown?.relevanceScore || 0.3);
  if (relevanceScore >= MIN_RELEVANCE_THRESHOLD && relevanceScore < 0.4) {
    return false;
  }

  return (
    ['new', 'reviewed', 'researching'].includes(lead.status) ||
    (lead.contactability_score || 0) < 60 ||
    lead.outreach_readiness_label !== 'Ready'
  );
}

async function runPermitIngestInternal(env, gateway, options = {}) {
  return runAutomationJob(
    gateway,
    {
      jobType: 'permit_ingest',
      provider: 'dob',
      summary: 'Scanning NYC DOB permits',
      detail: 'Pulling fresh permits, scoring fit, and upserting lead rows.',
      retryable: true,
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
  const contactsWithMeta = mergeStoredEmailCandidateMeta(context.contacts, leadRow);
  const derivedState = buildDerivedLeadState({
    leadRow,
    companyProfile: context.company,
    propertyProfile: context.property,
    contacts: contactsWithMeta,
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
      const contactsWithMeta = mergeStoredEmailCandidateMeta(context.contacts, lead);
      const draft = buildDraft({ ...lead, best_channel: lead.best_channel || 'email' }, context.company, contactsWithMeta);

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

async function markLeadEmailOutcomeInternal(env, gateway, leadId, contactId, payload = {}, options = {}) {
  const leadRow = await loadLeadForAction(gateway, leadId);
  if (!leadRow) {
    throw new Error('Lead not found');
  }

  const context = await loadLeadAutomationContext(gateway, leadRow.id);
  const contacts = mergeStoredEmailCandidateMeta(context.contacts, leadRow);
  const contact = contacts.find((entry) => entry.id === contactId);
  if (!contact?.email) {
    throw new Error('Email contact not found');
  }

  const outcome = payload.outcome || 'delivered';
  const nowIso = new Date().toISOString();
  const emailStrategy = {
    ...(leadRow.enrichment_summary?.emailStrategy || {}),
  };

  await runAutomationJob(
    gateway,
    {
      jobType: 'manual_enrichment',
      provider: 'worker',
      leadId: leadRow.id,
      summary: `Recording email outcome for ${leadRow.address}`,
      detail: 'Updating email trust history and fallback behavior.',
      retryable: false,
    },
    async () => {
      await recordEmailOutcome(gateway, {
        leadId: leadRow.id,
        email: contact.email,
        outcome,
        sentAt: leadRow.last_sent_at || nowIso,
        bounceType: payload.bounceType || '',
        bounceReason: payload.bounceReason || '',
        countAsSend: false,
      });

      if (outcome === 'bounced' && emailStrategy.activeEmailRole !== 'fallback' && emailStrategy.fallbackEmail) {
        emailStrategy.activeEmailRole = 'fallback';
        emailStrategy.emailVerifiedBy = 'bounce_detected';
        emailStrategy.primaryBouncedAt = nowIso;

        const latestDraft = context.latestDraft;
        if (latestDraft?.id) {
          await gateway.patch('outreach', [eq('id', latestDraft.id)], {
            recipient: emailStrategy.fallbackEmail,
            recipient_type: 'fallback',
            status: 'queued',
            metadata: {
              ...(latestDraft.metadata || {}),
              activeEmailRole: 'fallback',
            },
          });
        }
      } else if (outcome === 'replied') {
        emailStrategy.operatorVouched = true;
        emailStrategy.emailVerifiedBy = 'reply_detected';
      } else if (outcome === 'delivered') {
        emailStrategy.operatorVouched = true;
        emailStrategy.emailVerifiedBy = payload.verifiedBy || 'delivery_confirmed';
      }

      await gateway.patch('leads', [eq('id', leadRow.id)], {
        status: outcome === 'replied' ? 'replied' : outcome === 'bounced' ? 'outreach-ready' : leadRow.status,
        auto_send_reason: outcome === 'bounced' && emailStrategy.fallbackEmail
          ? 'Primary email bounced, fallback email is queued.'
          : leadRow.auto_send_reason || '',
        enrichment_summary: {
          ...(leadRow.enrichment_summary || {}),
          emailStrategy,
        },
      });

      await gateway.insert('activity_log', {
        id: createId('activity'),
        lead_id: leadRow.id,
        event_type: 'status_updated',
        summary: outcome === 'bounced' ? 'Email bounced' : outcome === 'replied' ? 'Reply recorded' : 'Email verified',
        detail: `${contact.email} marked as ${outcome}.`,
        metadata: {
          contactId,
          email: contact.email,
          outcome,
        },
      });
    },
    options,
  );

  return getPermitAutomationSnapshot(env);
}

export async function markLeadEmailOutcome(env, leadId, contactId, payload) {
  const gateway = createSupabaseGateway(env);
  return markLeadEmailOutcomeInternal(env, gateway, leadId, contactId, payload);
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

      const companyProfile = lead.companyProfile || {};
      const permit = lead.raw_permit || lead;
      const emailSelection = pickEmailContacts(contacts, companyProfile, permit);
      const activeRole = latestOutreach.metadata?.activeEmailRole || lead.channelDecision?.activeEmailRole || 'primary';
      const activeContact = activeRole === 'fallback'
        ? emailSelection.fallback || emailSelection.primary
        : emailSelection.primary || emailSelection.fallback;
      const activeTrust = activeContact ? buildEmailTrust(activeContact, companyProfile, permit) : null;
      if (!activeContact || !activeTrust?.assessment?.sendableManual) {
        throw new Error('No email available');
      }

      const duplicateSince = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
      const isDuplicate = await gateway.hasDuplicateOutreach(activeContact.email, duplicateSince);
      if (isDuplicate) {
        throw new Error('Duplicate within 30 days');
      }

      const gmailResult = await sendAutomationEmail(env, {
        recipient: activeContact.email,
        subject: latestOutreach.subject,
        body: latestOutreach.body,
      });

      const sentAt = new Date().toISOString();
      await gateway.patch('outreach', [eq('id', latestOutreach.id)], {
        status: 'sent',
        sent_at: sentAt,
        gmail_message_id: gmailResult.id || '',
        gmail_thread_id: gmailResult.threadId || '',
        recipient: activeContact.email,
        recipient_type: activeContact.type,
        metadata: {
          ...(latestOutreach.metadata || {}),
          manualSend: true,
          activeEmailRole: activeRole,
        },
      });
      await recordEmailOutcome(gateway, {
        leadId: leadRow.id,
        email: activeContact.email,
        outcome: 'unknown',
        sentAt,
      });

      await gateway.patch('leads', [eq('permit_key', lead.id)], {
        status: 'contacted',
        last_contacted_at: sentAt,
        last_sent_at: sentAt,
        duplicate_guard_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
        auto_send_reason: `Operator sent email to the ${activeRole} contact.`,
      });

      const latestLead = (await gateway.getLeadById(leadRow.id)) || leadRow;
      if (latestLead) {
        await recomputeLeadAutomationState(gateway, latestLead, {
          overrideStatus: 'contacted',
        });
      }

      return {
        success: true,
        recipient: activeContact.email,
        recipients: [activeContact.email],
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

  switch (job.job_type) {
    case 'permit_ingest':
      await runPermitIngestInternal(env, gateway, { existingJob: job });
      break;
    case 'enrichment_batch':
      await runEnrichmentBatchInternal(env, gateway, [], {
        limit: ENRICHMENT_BATCH_LIMIT,
        existingJob: job,
      });
      break;
    case 'lead_enrichment':
      if (!job.lead_id) {
        throw new Error('The failed enrichment job is missing its lead reference');
      }
      await enrichLeadNowInternal(env, gateway, job.lead_id, { existingJob: job });
      break;
    case 'draft_refresh':
      if (!job.lead_id) {
        throw new Error('The failed draft job is missing its lead reference');
      }
      await refreshLeadDraftNowInternal(env, gateway, job.lead_id, { existingJob: job });
      break;
    case 'send':
      if (!job.lead_id) {
        throw new Error('The failed send job is missing its lead reference');
      }
      await sendLeadNowInternal(env, gateway, job.lead_id, { existingJob: job });
      break;
    default:
      throw new Error('Retry is not supported for this job type yet');
  }

  return getPermitAutomationSnapshot(env);
}
