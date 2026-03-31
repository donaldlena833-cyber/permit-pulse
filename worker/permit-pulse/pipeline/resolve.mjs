import { appendLeadEvent } from '../lib/events.mjs';
import { isDirectoryEmailDomain } from '../lib/email.mjs';
import { eq, order } from '../lib/supabase.mjs';
import { clamp, cleanCompanyName, getBaseDomain, normalizeText, normalizeWhitespace, uniq } from '../lib/utils.mjs';

const ARCHITECT_FIRM_TOKENS = [
  'architect',
  'architects',
  'architecture',
  'design',
  'designer',
  'interior',
  'interiors',
  'studio',
  'atelier',
];

function tokenizeCompany(value) {
  return cleanCompanyName(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function countTokenMatches(tokens, haystack) {
  return tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
}

function buildLeadCompanyTokens(lead) {
  return uniq([
    ...tokenizeCompany(lead?.applicant_name || ''),
    ...tokenizeCompany(lead?.owner_name || ''),
    ...tokenizeCompany(lead?.company_name || ''),
  ]);
}

function hasArchitectFirmSignal(...values) {
  const searchable = normalizeText(values.join(' '));
  return ARCHITECT_FIRM_TOKENS.some((token) => searchable.includes(token));
}

function leadPrefersArchitects(lead) {
  return hasArchitectFirmSignal(lead?.applicant_name, lead?.owner_name);
}

function scoreResolverCandidate(lead, candidate) {
  const domain = getBaseDomain(candidate.domain || candidate.website || '');
  const companyTokens = buildLeadCompanyTokens(lead);
  const nameText = normalizeText(candidate.company_name || '');
  const searchable = normalizeText([candidate.company_name, candidate.website, candidate.domain].join(' '));
  const nameMatches = countTokenMatches(companyTokens, nameText);
  const domainMatches = countTokenMatches(companyTokens, domain);
  const totalMatches = countTokenMatches(companyTokens, searchable);
  let confidence = Number(candidate.confidence || 0);
  const reasons = Array.isArray(candidate.reasons) ? [...candidate.reasons] : [];
  const architectFocusedLead = leadPrefersArchitects(lead);

  if (candidate.website) {
    confidence += 6;
  }
  if (nameMatches > 0) {
    confidence += Math.min(nameMatches * 12, 24);
    reasons.push('Candidate name matches permit company tokens');
  }
  if (domainMatches > 0) {
    confidence += Math.min(domainMatches * 10, 20);
    reasons.push('Candidate domain matches permit company tokens');
  }
  if (candidate.source === 'google_maps' && candidate.website) {
    confidence += 8;
  }
  if (candidate.source === 'brave_search' && candidate.website) {
    confidence += 5;
  }
  if (candidate.source === 'permit_data' && !candidate.website && !domain) {
    confidence -= 10;
  }
  if (isDirectoryEmailDomain(domain)) {
    confidence -= 60;
    reasons.push('Directory/social domain deprioritized');
  }
  if (architectFocusedLead && hasArchitectFirmSignal(candidate.company_name, candidate.website, candidate.domain)) {
    confidence += 14;
    reasons.push('Architect/design firm matches permit applicant');
  }
  if (domain && companyTokens.length > 0 && totalMatches === 0 && candidate.source !== 'permit_data') {
    confidence -= 25;
    reasons.push('No permit-company token match');
  }
  if (!candidate.website && !domain && candidate.source !== 'permit_data') {
    confidence -= 10;
  }

  return {
    ...candidate,
    domain,
    confidence: clamp(confidence, 0, 95),
    reasons,
  };
}

async function searchBraveWebsite(env, lead) {
  const query = `${lead.applicant_name || lead.owner_name || ''} ${lead.address || ''} ${leadPrefersArchitects(lead) ? 'architect design' : ''}`.trim();
  if (!env.BRAVE_API_KEY || !query) {
    return null;
  }
  const companyTokens = buildLeadCompanyTokens(lead);
  if (companyTokens.length === 0) {
    return null;
  }

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': env.BRAVE_API_KEY,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const result = Array.isArray(payload?.web?.results)
    ? payload.web.results
      .filter((item) => item?.url)
      .map((item) => {
        const domain = getBaseDomain(item.url);
        const searchable = normalizeText([item.title, item.description, item.url].join(' '));
        const tokenMatches = countTokenMatches(companyTokens, searchable);
        let score = tokenMatches * 12;
        if (domain && countTokenMatches(companyTokens, domain) > 0) {
          score += 10;
        }
        if (leadPrefersArchitects(lead) && hasArchitectFirmSignal(item.title, item.description, item.url)) {
          score += 12;
        }
        if (isDirectoryEmailDomain(domain)) {
          score -= 50;
        }
        return { item, score, domain };
      })
      .filter((entry) => entry.score > -10)
      .sort((left, right) => right.score - left.score)[0]
    : null;

  if (!result?.item?.url) {
    return null;
  }

  return {
    company_name: cleanCompanyName(result.item.title || lead.applicant_name || lead.owner_name || query),
    website: result.item.url,
    domain: result.domain,
    source: 'brave_search',
    confidence: clamp(32 + result.score, 20, 82),
    reasons: ['Brave search found matching website'],
  };
}

async function searchGoogleMapsCandidate(env, lead) {
  if (!env.GOOGLE_MAPS_API_KEY || !lead.address) {
    return null;
  }

  const query = `${lead.applicant_name || lead.owner_name || ''} ${lead.address}`.trim();
  if (!query) {
    return null;
  }
  const companyTokens = buildLeadCompanyTokens(lead);
  if (companyTokens.length === 0) {
    return null;
  }

  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${env.GOOGLE_MAPS_API_KEY}`;
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    return null;
  }

  const searchPayload = await searchResponse.json();
  const place = Array.isArray(searchPayload?.results)
    ? searchPayload.results
      .map((entry) => {
        let score = countTokenMatches(companyTokens, normalizeText(entry?.name || '')) * 14;
        if (leadPrefersArchitects(lead) && hasArchitectFirmSignal(entry?.name || '')) {
          score += 12;
        }
        return { entry, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.entry
    : null;
  if (!place?.place_id) {
    return null;
  }

  const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place.place_id)}&fields=name,website,formatted_phone_number&key=${env.GOOGLE_MAPS_API_KEY}`;
  const detailResponse = await fetch(detailUrl);
  if (!detailResponse.ok) {
    return null;
  }

  const detailPayload = await detailResponse.json();
  const detail = detailPayload?.result;
  if (!detail?.name) {
    return null;
  }

  return {
    company_name: cleanCompanyName(detail.name),
    website: detail.website || '',
    domain: getBaseDomain(detail.website || ''),
    phone: detail.formatted_phone_number || '',
    source: 'google_maps',
    confidence: detail.website ? 55 : 36,
    reasons: ['Google Maps matched business at project address'],
  };
}

function buildPermitCandidates(lead) {
  const candidates = [];
  if (lead.applicant_name) {
    const applicantIsArchitectFirm = hasArchitectFirmSignal(lead.applicant_name);
    candidates.push({
      company_name: cleanCompanyName(lead.applicant_name),
      website: '',
      domain: '',
      source: 'permit_data',
      confidence: applicantIsArchitectFirm ? 48 : 35,
      reasons: [applicantIsArchitectFirm ? 'Architect/design applicant from permit' : 'Applicant name from permit'],
    });
  }
  if (lead.owner_name && cleanCompanyName(lead.owner_name) !== cleanCompanyName(lead.applicant_name)) {
    const ownerIsArchitectFirm = hasArchitectFirmSignal(lead.owner_name);
    candidates.push({
      company_name: cleanCompanyName(lead.owner_name),
      website: '',
      domain: '',
      source: 'permit_data',
      confidence: ownerIsArchitectFirm ? 32 : 25,
      reasons: [ownerIsArchitectFirm ? 'Architect/design owner from permit' : 'Owner name from permit'],
    });
  }
  return candidates;
}

function buildCarryForwardCandidates(lead, history = []) {
  const candidates = [];

  if (lead.company_name || lead.company_website || lead.company_domain) {
    candidates.push({
      company_name: cleanCompanyName(lead.company_name || lead.applicant_name || lead.owner_name || ''),
      website: lead.company_website || '',
      domain: lead.company_domain || getBaseDomain(lead.company_website || ''),
      source: 'previous_resolution',
      confidence: lead.company_website || lead.company_domain ? 58 : 38,
      reasons: ['Previously resolved company retained on lead'],
    });
  }

  for (const row of history) {
    if (!row.website && !row.domain) {
      continue;
    }
    candidates.push({
      company_name: cleanCompanyName(row.company_name || lead.company_name || lead.applicant_name || lead.owner_name || ''),
      website: row.website || '',
      domain: row.domain || getBaseDomain(row.website || ''),
      source: row.source || 'previous_resolution',
      confidence: Math.max(Number(row.confidence || 0), 58),
      reasons: ['Previously resolved company recovered from lead history'],
    });
  }

  return candidates;
}

function dedupeCandidates(candidates) {
  const bestByKey = new Map();

  for (const candidate of candidates) {
    const key = [
      getBaseDomain(candidate.domain || candidate.website || ''),
      normalizeWhitespace(candidate.website || ''),
      cleanCompanyName(candidate.company_name || ''),
    ].filter(Boolean).join('::');

    if (!key) {
      continue;
    }

    const current = bestByKey.get(key);
    if (!current || Number(candidate.confidence || 0) > Number(current.confidence || 0)) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values());
}

function rankCandidates(lead, candidates) {
  return dedupeCandidates(candidates)
    .map((candidate) => scoreResolverCandidate(lead, candidate))
    .filter((candidate) => candidate.company_name && Number(candidate.confidence || 0) >= 20)
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0));
}

export async function resolveLeadCompany(env, db, runId, leadId) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    return null;
  }

  const history = await db.select('v2_company_candidates', {
    filters: [eq('lead_id', leadId)],
    ordering: [order('discovered_at', 'desc')],
    limit: 10,
  });

  const permitCandidates = buildPermitCandidates(lead);
  const carryForwardCandidates = buildCarryForwardCandidates(lead, history);
  const [braveCandidate, mapsCandidate] = await Promise.all([
    searchBraveWebsite(env, lead),
    searchGoogleMapsCandidate(env, lead),
  ]);

  const candidates = rankCandidates(
    lead,
    [
      ...carryForwardCandidates,
      ...permitCandidates,
      ...(braveCandidate ? [braveCandidate] : []),
      ...(mapsCandidate ? [mapsCandidate] : []),
    ],
  );

  await db.update('v2_company_candidates', [eq('lead_id', leadId), eq('is_current', true)], {
    is_current: false,
  });

  let chosen = null;

  for (const [index, candidate] of candidates.entries()) {
    const [row] = await db.insert('v2_company_candidates', {
      lead_id: leadId,
      run_id: runId,
      company_name: candidate.company_name,
      domain: candidate.domain || '',
      website: candidate.website || '',
      source: candidate.source,
      confidence: candidate.confidence,
      reasons: candidate.reasons,
      is_current: true,
      is_chosen: index === 0,
      rejected_reason: index === 0 ? null : 'Lower confidence than chosen company',
    });

    if (index === 0) {
      chosen = { ...candidate, id: row?.id };
    }
  }

  if (!chosen) {
    return null;
  }

  await db.update('v2_leads', [`id=eq.${leadId}`], {
    company_name: chosen.company_name || lead.company_name || '',
    company_domain: chosen.domain || lead.company_domain || getBaseDomain(chosen.website || lead.company_website || ''),
    company_website: chosen.website || lead.company_website || '',
    company_confidence: chosen.confidence || 0,
    contact_phone: mapsCandidate?.phone || lead.contact_phone || '',
    updated_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'company_selected',
    detail: {
      company_name: chosen.company_name,
      source: chosen.source,
      website: normalizeWhitespace(chosen.website || ''),
    },
  });

  return chosen;
}
