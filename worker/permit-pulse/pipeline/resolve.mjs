import { appendLeadEvent } from '../lib/events.mjs';
import { eq, order } from '../lib/supabase.mjs';
import { cleanCompanyName, getBaseDomain, normalizeWhitespace } from '../lib/utils.mjs';

async function searchBraveWebsite(env, query) {
  if (!env.BRAVE_API_KEY || !query) {
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
    ? payload.web.results.find((item) => item?.url && !String(item.url).includes('linkedin.com'))
    : null;

  if (!result?.url) {
    return null;
  }

  return {
    company_name: cleanCompanyName(result.title || query),
    website: result.url,
    domain: getBaseDomain(result.url),
    source: 'brave_search',
    confidence: 50,
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

  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${env.GOOGLE_MAPS_API_KEY}`;
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    return null;
  }

  const searchPayload = await searchResponse.json();
  const place = Array.isArray(searchPayload?.results) ? searchPayload.results[0] : null;
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
    confidence: detail.website ? 60 : 42,
    reasons: ['Google Maps matched business at project address'],
  };
}

function buildPermitCandidates(lead) {
  const candidates = [];
  if (lead.applicant_name) {
    candidates.push({
      company_name: cleanCompanyName(lead.applicant_name),
      website: '',
      domain: '',
      source: 'permit_data',
      confidence: 35,
      reasons: ['Applicant name from permit'],
    });
  }
  if (lead.owner_name && cleanCompanyName(lead.owner_name) !== cleanCompanyName(lead.applicant_name)) {
    candidates.push({
      company_name: cleanCompanyName(lead.owner_name),
      website: '',
      domain: '',
      source: 'permit_data',
      confidence: 25,
      reasons: ['Owner name from permit'],
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

function rankCandidates(candidates) {
  return dedupeCandidates(candidates)
    .filter((candidate) => candidate.company_name)
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
    searchBraveWebsite(env, `${lead.applicant_name || lead.owner_name || ''} ${lead.address || ''}`.trim()),
    searchGoogleMapsCandidate(env, lead),
  ]);

  const candidates = rankCandidates([
    ...carryForwardCandidates,
    ...permitCandidates,
    ...(braveCandidate ? [braveCandidate] : []),
    ...(mapsCandidate ? [mapsCandidate] : []),
  ]);

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
