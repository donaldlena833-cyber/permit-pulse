import {
  API_ENDPOINTS,
  AUTO_SEND_LIMITS,
  DEFAULT_SCAN_LIMIT,
  DEFAULT_SCAN_WINDOW_DAYS,
  HIGH_VALUE_SCORE,
  METROGLASS_PROFILE,
  NYC_BUSINESS_HOURS,
  NYC_TIME_ZONE,
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
  'opencorporates.com',
  'chamberofcommerce.com',
  'nextdoor.com',
];

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

function getProjectAngle(lead) {
  const description = normalizeText(lead.description || lead.raw_permit?.job_description);
  if (description.includes('storefront') || description.includes('retail')) {
    return 'storefront and entry glass work';
  }
  if (description.includes('partition') || description.includes('office')) {
    return 'commercial glass partitions';
  }
  if (description.includes('mirror')) {
    return 'custom mirrors';
  }
  if (description.includes('shower') || description.includes('bathroom')) {
    return 'shower glass';
  }
  return 'custom glass scope';
}

function buildLeadScore(permit) {
  const text = buildSearchableText(permit);
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
    directHits.length > 0
      ? 'Strong glazing signal in permit description.'
      : inferredHits.length > 0
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
  const publicEmail = contacts.find((contact) => contact.email && contact.type === 'public');
  const guessedEmail = contacts.find((contact) => contact.email && contact.type === 'guessed');
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

function buildOutreachReadiness(score, contactability, companyProfile, contacts) {
  let readiness = 0;
  const blockers = [];

  readiness += Math.round(score * 0.45);
  readiness += Math.round(contactability.total * 0.4);
  readiness += Math.round((companyProfile.confidence || 0) * 0.15);

  if (!contacts.find((contact) => contact.email || contact.phone || contact.contact_form_url)) {
    blockers.push('No outreach route found');
    readiness -= 20;
  }

  if (companyProfile.match_strength === 'weak') {
    blockers.push('Company match is weak');
    readiness -= 15;
  }

  if ((companyProfile.confidence || 0) < 35) {
    blockers.push('Company confidence is too light');
  }

  const scoreValue = clamp(readiness);
  const label =
    scoreValue >= 75 ? 'Ready' : scoreValue >= 55 ? 'Almost Ready' : scoreValue >= 35 ? 'Needs Review' : 'Blocked';
  const explanation =
    label === 'Ready'
      ? 'Enough context and contact data exist to move directly into outreach.'
      : label === 'Almost Ready'
        ? 'Close to sendable, but still worth one more pass.'
        : label === 'Needs Review'
          ? 'The lead has promise, but the automation confidence is not high enough yet.'
          : 'The lead needs more research before it should be touched.';

  return {
    score: scoreValue,
    label,
    explanation,
    blockers,
  };
}

function buildChannelDecision({ score, contactability, companyProfile, contacts, permit }) {
  const hasEmail = contacts.some((contact) => contact.email);
  const hasPhone = contacts.some((contact) => contact.phone);
  const hasForm = contacts.some((contact) => contact.contact_form_url);
  const premiumFirm = METROGLASS_PROFILE.linkedinSignals.some((signal) =>
    normalizeText(companyProfile.normalized_name || companyProfile.company_name).includes(signal),
  );

  if (hasEmail) {
    return {
      primary: 'email',
      reason: 'Email is available, which is still the cleanest first channel.',
      alternatives: uniq([hasPhone ? 'phone' : '', hasForm ? 'form' : '']).filter(Boolean),
      autoSendEligible: score >= 55 && contactability.total >= 55 && companyProfile.match_strength !== 'weak',
    };
  }

  if (hasPhone) {
    return {
      primary: 'phone',
      reason: 'No email is available, but there is a phone route for fast contractor outreach.',
      alternatives: uniq([hasForm ? 'form' : '', premiumFirm ? 'linkedin' : '']).filter(Boolean),
      autoSendEligible: false,
    };
  }

  if (hasForm) {
    return {
      primary: 'form',
      reason: 'The contact form is the best reachable route right now.',
      alternatives: premiumFirm ? ['linkedin'] : [],
      autoSendEligible: false,
    };
  }

  return {
    primary: premiumFirm && score >= 55 ? 'linkedin' : 'linkedin',
    reason:
      premiumFirm && !hasEmail
        ? 'Premium architect or design profile with no email found, LinkedIn is worth drafting.'
        : `No direct contact route is available yet for ${permit.owner_business_name || getApplicantName(permit) || 'this lead'}.`,
    alternatives: [],
    autoSendEligible: false,
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

function pickPrimaryContact(contacts) {
  const emailContacts = [...contacts]
    .filter((contact) => contact.email)
    .sort((left, right) => {
      const rank = { verified: 3, public: 2, guessed: 1 };
      return (rank[right.type] || 0) - (rank[left.type] || 0) || (right.confidence || 0) - (left.confidence || 0);
    });

  return emailContacts[0] || contacts.find((contact) => contact.phone) || contacts.find((contact) => contact.contact_form_url) || null;
}

function buildDraft(lead, companyProfile, contacts) {
  const primaryContact = pickPrimaryContact(contacts);
  const address = lead.address;
  const projectAngle = getProjectAngle(lead);
  const pluginLine = getPluginLine(`${lead.permit_key}:${lead.score}`);
  const contactName = primaryContact?.name || permitLikeName(lead.owner_business_name) || permitLikeName(lead.applicant_name) || 'there';
  const subject = `${address}, glass scope`;
  const body = [
    `Hi ${contactName},`,
    '',
    `I came across the permit at ${address}, and the project reads like a possible fit for ${projectAngle}.`,
    '',
    `MetroGlass Pro handles shower glass, mirrors, storefronts, and partitions around Manhattan, Brooklyn, and Queens.`,
    '',
    pluginLine,
    '',
    'If this scope is still open, would it be useful if I sent over pricing or a quick takeoff?',
    '',
    'Donald',
    'MetroGlass Pro',
    '332 999 3846',
  ].join('\n');

  return {
    subject,
    body,
    pluginLine,
    introLine: `I came across the permit at ${address}, and the project reads like a possible fit for ${projectAngle}.`,
    callOpener: `This is Donald from MetroGlass Pro. I saw the permit at ${address}, and wanted to ask who is handling the glass scope on that job.`,
    followUpNote: `Following up on the permit at ${address}. If the glass scope is still open, I can send over a quick number.`,
    recipient: primaryContact?.email || '',
    recipientType: primaryContact?.type || '',
    autoChannel: lead.best_channel || 'email',
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
    lead_tier: getLeadTier(scoreBreakdown.total),
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
    enrichment_summary: {},
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
  const searchable = `${title} ${description} ${domain}`;
  const permitContext = stripCompanySuffix([
    permit.borough,
    permit.job_description,
    permit.work_type,
    permit.filing_reason,
  ].join(' '));

  let score = 15;
  const tokenMatches = countTokenMatches(seedTokens, searchable);
  score += tokenMatches * 12;

  if (normalizedSeed && searchable.includes(normalizedSeed)) {
    score += 26;
  }

  if (title.includes(normalizedSeed)) {
    score += 20;
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
  const domain = companyProfile.domain;
  if (!domain) {
    return [];
  }

  const nameSeed = permit.owner_name || getApplicantName(permit) || '';
  const parts = nameSeed
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return [];
  }

  const [first, ...rest] = parts;
  const last = rest[rest.length - 1];
  const patterns = uniq([
    'info',
    'contact',
    'office',
    'sales',
    'hello',
    'estimating',
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
  if (!env.ZEROBOUNCE_API_KEY || !email || !shouldVerify) {
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

  searchSignals.emails.forEach((email, index) => {
    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || getApplicantName(permit) || '',
      role: company.role || 'owner',
      email,
      phone: '',
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'public',
      confidence: 66,
      source: 'brave_search',
      verified: false,
      is_primary: index === 0,
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
      is_primary: index === 0 && searchSignals.emails.length === 0,
    });
  });

  (websiteSignals?.emails || []).forEach((email, index) => {
    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || '',
      role: company.role || 'owner',
      email,
      phone: '',
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: index === 0 ? 'public' : 'public',
      confidence: 72,
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
    contacts.push({
      id: createId('contact'),
      name: permit.owner_name || '',
      role: company.role || 'owner',
      email,
      phone: '',
      website_url: company.website || searchSignals.website || '',
      linkedin_url: socialLinks.linkedin_url || '',
      instagram_url: socialLinks.instagram_url || '',
      contact_form_url: socialLinks.contact_form_url || '',
      type: 'guessed',
      confidence: 48,
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
  const contactability = buildContactability(permit, propertyProfile, company, dedupedContacts);
  const readiness = buildOutreachReadiness(leadRow.score, contactability, company, dedupedContacts);
  const channelDecision = buildChannelDecision({
    score: leadRow.score,
    contactability,
    companyProfile: company,
    contacts: dedupedContacts,
    permit,
  });
  const draft = buildDraft(leadRow, company, dedupedContacts);
  const primaryEmail = pickPrimaryContact(dedupedContacts)?.email || '';
  const shouldVerify =
    channelDecision.primary === 'email' &&
    leadRow.score >= HIGH_VALUE_SCORE &&
    readiness.score >= 70 &&
    Boolean(primaryEmail);
  const verification = await maybeVerifyEmail(env, primaryEmail, shouldVerify);

  if (verification.verified && primaryEmail) {
    const primaryContact = dedupedContacts.find((contact) => contact.email === primaryEmail);
    if (primaryContact) {
      primaryContact.type = 'verified';
      primaryContact.verified = true;
      primaryContact.confidence = Math.max(primaryContact.confidence, verification.confidence);
    }
  }

  const nowIso = new Date().toISOString();
  const enrichedLead = {
    ...leadRow,
    priority_label:
      leadRow.score >= 75 && contactability.total >= 60
        ? 'Attack Now'
        : leadRow.score >= 55
          ? 'Research Today'
          : leadRow.score >= 35
            ? 'Worth a Try'
            : leadRow.score >= 20
              ? 'Monitor'
              : 'Ignore',
    priority_score: Math.round((leadRow.score * 0.55) + (contactability.total * 0.25) + (readiness.score * 0.2)),
    status: readiness.label === 'Blocked' ? 'needs review' : readiness.label === 'Ready' ? 'outreach-ready' : 'researching',
    contactability_score: contactability.total,
    contactability_label: contactability.label,
    outreach_readiness_score: readiness.score,
    outreach_readiness_label: readiness.label,
    linkedin_worthy: channelDecision.primary === 'linkedin',
    best_channel: channelDecision.primary,
    best_next_action: {
      label:
        channelDecision.primary === 'email'
          ? 'Email first'
          : channelDecision.primary === 'phone'
            ? 'Call first'
            : channelDecision.primary === 'form'
              ? 'Contact form'
              : 'LinkedIn draft',
      detail: channelDecision.reason,
      queue:
        channelDecision.primary === 'phone'
          ? 'call'
          : channelDecision.primary === 'form'
            ? 'form'
            : channelDecision.primary === 'linkedin'
              ? 'dm'
              : 'email',
      urgency: readiness.label === 'Ready' ? 'high' : readiness.label === 'Almost Ready' ? 'medium' : 'low',
    },
    contactability_breakdown: contactability,
    enrichment_summary: {
      company,
      property: propertyProfile,
      readiness,
      channelDecision,
      draft,
      verification,
    },
    company_match_strength: company.match_strength,
    company_domain: company.domain,
    property_confidence: propertyProfile.confidence,
    enrichment_confidence: Math.round((company.confidence * 0.45) + (propertyProfile.confidence * 0.3) + (readiness.score * 0.25)),
    auto_send_eligible:
      channelDecision.autoSendEligible &&
      readiness.label !== 'Blocked' &&
      company.match_strength !== 'weak' &&
      Boolean(primaryEmail || draft.recipient),
    auto_send_reason: channelDecision.autoSendEligible
      ? 'Score, contactability, company match, and channel rules all pass.'
      : 'Lead still needs review before automation should send.',
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
      detail: channelDecision.reason,
      metadata: {
        companyConfidence: company.confidence,
        propertyConfidence: propertyProfile.confidence,
        readiness: readiness.label,
      },
    }),
  ]);

  const outreachDraftRecord = {
    id: createId('outreach'),
    lead_id: leadId,
    channel: channelDecision.primary,
    recipient: draft.recipient || '',
    recipient_type: draft.recipientType || channelDecision.primary,
    subject: draft.subject,
    draft: draft.body,
    plugin_line: draft.pluginLine,
    call_opener: draft.callOpener,
    follow_up_note: draft.followUpNote,
    status: enrichedLead.auto_send_eligible ? 'queued' : 'draft',
    metadata: {
      introLine: draft.introLine,
      companyWebsite: company.website,
      alternatives: channelDecision.alternatives,
    },
  };

  await gateway.insert('outreach', outreachDraftRecord);

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

  const business = getBusinessHourState();
  if (!business.insideBusinessHours) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'Queued, but outside NYC business hours.',
    });
    return { sent: false, reason: 'Outside business hours' };
  }

  const now = new Date();
  const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
  const lastHour = new Date(now.getTime() - (60 * 60 * 1000)).toISOString();
  const [sentToday, sentThisHour] = await Promise.all([
    gateway.countSentSince(last24Hours),
    gateway.countSentSince(lastHour),
  ]);

  if (sentToday >= AUTO_SEND_LIMITS.perDay || sentThisHour >= AUTO_SEND_LIMITS.perHour) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'Queued, but send throttle limit reached.',
    });
    return { sent: false, reason: 'Throttle limit reached' };
  }

  const primaryContact = pickPrimaryContact(contacts);
  if (!primaryContact?.email) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'No email route available for auto-send.',
      status: 'needs review',
    });
    return { sent: false, reason: 'No email contact' };
  }

  const duplicateSince = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  const isDuplicate = await gateway.hasDuplicateOutreach(primaryContact.email, duplicateSince);
  if (isDuplicate) {
    await gateway.patch('leads', [eq('id', lead.id)], {
      auto_send_reason: 'Duplicate detected inside 30-day window.',
      status: 'needs review',
    });
    return { sent: false, reason: 'Duplicate within 30 days' };
  }

  const gmailResult = await sendAutomationEmail(env, {
    recipient: primaryContact.email,
    subject: outreachDraft.subject,
    body: outreachDraft.draft,
  });

  const sentAt = new Date().toISOString();
  await Promise.all([
    gateway.patch('outreach', [eq('id', outreachDraft.id)], {
      status: 'sent',
      sent_at: sentAt,
      gmail_message_id: gmailResult.id || '',
      gmail_thread_id: gmailResult.threadId || '',
      recipient: primaryContact.email,
      recipient_type: primaryContact.type,
    }),
    gateway.patch('leads', [eq('id', lead.id)], {
      status: 'contacted',
      last_contacted_at: sentAt,
      last_sent_at: sentAt,
      duplicate_guard_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
      auto_send_reason: 'Email sent automatically inside NYC business hours.',
    }),
    gateway.insert('activity_log', {
      id: createId('activity'),
      lead_id: lead.id,
      event_type: 'email_sent',
      summary: 'Email sent automatically',
      detail: `Sent to ${primaryContact.email}`,
      metadata: {
        outreachId: outreachDraft.id,
        gmailMessageId: gmailResult.id || '',
      },
    }),
  ]);

  return { sent: true, recipient: primaryContact.email, outreachId: outreachDraft.id };
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
    const manualEnrichment = lead.enrichment_summary?.manualEnrichment || {};
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
      scoreBreakdown: lead.score_breakdown || {},
      leadTier: lead.lead_tier || getLeadTier(lead.score),
      contactability: lead.contactability_breakdown || {
        total: lead.contactability_score,
        label: lead.contactability_label,
        reasons: [],
        missing: [],
        explanation: '',
      },
      nextAction: lead.best_next_action || {
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
        explanation: lead.enrichment_summary?.readiness?.explanation || '',
        blockers: lead.enrichment_summary?.readiness?.blockers || [],
      },
      channelDecision: {
        primary: lead.best_channel || 'email',
        reason: lead.enrichment_summary?.channelDecision?.reason || '',
        alternatives: lead.enrichment_summary?.channelDecision?.alternatives || [],
        autoSendEligible: Boolean(lead.auto_send_eligible),
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
    case 'email_sent':
      return 'draft-created';
    case 'status_updated':
      return 'status-changed';
    default:
      return 'reviewed';
  }
}

export async function runPermitAutomationCycle(env) {
  const gateway = createSupabaseGateway(env);
  const ingestResult = await runPermitIngestInternal(env, gateway);
  const enrichmentResult = await runEnrichmentBatchInternal(env, gateway, ingestResult.leads, {
    limit: ENRICHMENT_BATCH_LIMIT,
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
  return (
    ['new', 'reviewed', 'researching'].includes(lead.status) ||
    (lead.contactability_score || 0) < 60 ||
    lead.outreach_readiness_label !== 'Ready'
  );
}

async function runPermitIngestInternal(env, gateway) {
  const permits = await fetchDobPermits();
  const leadRows = permits
    .map((permit) => ({
      permit,
      scoreBreakdown: buildLeadScore(permit),
    }))
    .filter((entry) => entry.scoreBreakdown.total > 0 && entry.scoreBreakdown.disqualifiers.length === 0)
    .map((entry) => buildLeadRow(entry.permit, entry.scoreBreakdown));

  if (leadRows.length === 0) {
    return {
      scanned: permits.length,
      ingested: 0,
      leads: [],
    };
  }

  const ingested = await gateway.upsert('leads', leadRows, 'permit_key');
  return {
    scanned: permits.length,
    ingested: ingested.length,
    leads: ingested,
  };
}

async function runEnrichmentBatchInternal(env, gateway, candidateLeads = [], options = {}) {
  const limit = options.limit || ENRICHMENT_BATCH_LIMIT;
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
  let sent = 0;

  for (const lead of queue) {
    const enrichedLead = await enrichLead(env, gateway, lead);
    enriched.push(enrichedLead);
    const sendResult = await maybeAutoSend(env, gateway, enrichedLead);
    if (sendResult.sent) {
      sent += 1;
    }
  }

  return {
    attempted: queue.length,
    enriched: enriched.length,
    sent,
    leads: enriched,
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

export async function getPermitAutomationSnapshot(env) {
  const gateway = createSupabaseGateway(env);
  const snapshot = await gateway.getQueueSnapshot();
  return mapSnapshot(snapshot);
}

export async function enrichLeadNow(env, leadId) {
  const gateway = createSupabaseGateway(env);
  const lead = (await gateway.getLeadByPermitKey(leadId)) || (await gateway.getLeadById(leadId));
  if (!lead) {
    throw new Error('Lead not found');
  }

  await enrichLead(env, gateway, lead, { force: true });
  return getPermitAutomationSnapshot(env);
}

export async function updateLeadAutomationState(env, leadId, patch) {
  const gateway = createSupabaseGateway(env);
  const lead = (await gateway.getLeadByPermitKey(leadId)) || (await gateway.getLeadById(leadId));
  if (!lead) {
    throw new Error('Lead not found');
  }

  if (patch.status) {
    await gateway.patch('leads', [eq('id', lead.id)], { status: patch.status });
    await gateway.insert('activity_log', {
      id: createId('activity'),
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
      ...(lead.enrichment_summary?.manualEnrichment || {}),
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
        id: createId('contact'),
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
        id: createId('contact'),
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

    await gateway.patch('leads', [eq('id', lead.id)], {
      enrichment_summary: {
        ...(lead.enrichment_summary || {}),
        manualEnrichment: nextManualEnrichment,
      },
    });
    await gateway.replaceContacts(lead.id, [...preservedContacts, ...manualContacts]);
    await gateway.insert('activity_log', {
      id: createId('activity'),
      lead_id: lead.id,
      event_type: 'manual_enrichment',
      summary: 'Lead enrichment updated',
      detail: 'Manual enrichment changes were saved from the workspace.',
      metadata: {},
    });
  }

  if (patch.draft) {
    const existingDraft = (
      await gateway.select('outreach', {
        filters: [eq('lead_id', lead.id)],
        ordering: [order('created_at', 'desc')],
        pageLimit: 1,
      })
    )[0];
    const hasDraftField = (field) => Object.prototype.hasOwnProperty.call(patch.draft, field);

    const draftPayload = {
      channel: 'email',
      recipient: hasDraftField('recipient') ? patch.draft.recipient || '' : existingDraft?.recipient || '',
      recipient_type: hasDraftField('recipientType')
        ? patch.draft.recipientType || 'manual'
        : existingDraft?.recipient_type || 'manual',
      subject: hasDraftField('subject') ? patch.draft.subject || '' : existingDraft?.subject || '',
      draft: hasDraftField('body') ? patch.draft.body || '' : existingDraft?.draft || '',
      plugin_line: hasDraftField('pluginLine')
        ? patch.draft.pluginLine || ''
        : existingDraft?.plugin_line || '',
      call_opener: hasDraftField('callOpener') ? patch.draft.callOpener || '' : existingDraft?.call_opener || '',
      follow_up_note: hasDraftField('followUpNote')
        ? patch.draft.followUpNote || ''
        : existingDraft?.follow_up_note || '',
      status: existingDraft?.status === 'sent' ? 'draft' : existingDraft?.status || 'draft',
      metadata: {
        ...(existingDraft?.metadata || {}),
        introLine: hasDraftField('introLine') ? patch.draft.introLine || '' : existingDraft?.metadata?.introLine || '',
        updatedAt: new Date().toISOString(),
      },
    };

    if (existingDraft && existingDraft.status !== 'sent') {
      await gateway.patch('outreach', [eq('id', existingDraft.id)], draftPayload);
    } else {
      await gateway.insert('outreach', {
        id: createId('outreach'),
        lead_id: lead.id,
        ...draftPayload,
      });
    }
  }

  return getPermitAutomationSnapshot(env);
}

export async function sendLeadNow(env, leadId) {
  const gateway = createSupabaseGateway(env);
  const snapshot = await gateway.getQueueSnapshot();
  const mapped = mapSnapshot(snapshot);
  const lead = mapped.leads.find((item) => item.id === leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const contacts = lead.contacts || [];
  const latestOutreach = lead.outreachHistory?.[0];
  if (!latestOutreach?.subject || !latestOutreach?.body) {
    throw new Error('No draft available to send');
  }

  const primaryContact = contacts.find((contact) => contact.email) || null;
  if (!primaryContact?.email) {
    throw new Error('No email available');
  }

  const gmailResult = await sendAutomationEmail(env, {
    recipient: primaryContact.email,
    subject: latestOutreach.subject,
    body: latestOutreach.body,
  });

  const sentAt = new Date().toISOString();
  await Promise.all([
    gateway.patch('outreach', [eq('id', latestOutreach.id)], {
      status: 'sent',
      sent_at: sentAt,
      gmail_message_id: gmailResult.id || '',
      gmail_thread_id: gmailResult.threadId || '',
      recipient: primaryContact.email,
      recipient_type: primaryContact.type,
    }),
    gateway.patch('leads', [eq('permit_key', leadId)], {
      status: 'contacted',
      last_contacted_at: sentAt,
      last_sent_at: sentAt,
    }),
  ]);

  return { success: true, recipient: primaryContact.email, sentAt };
}
