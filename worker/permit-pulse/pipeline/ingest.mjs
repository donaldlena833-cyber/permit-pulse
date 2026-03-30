import nycDob from '../sources/nyc-dob.mjs';
import { METROGLASS_PROFILE, PERMIT_RELEVANCE_RULES } from '../config.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';
import {
  buildPermitKey,
  cleanCompanyName,
  nowIso,
  normalizeText,
  normalizeWhitespace,
} from '../lib/utils.mjs';

const SOURCES = {
  nyc_dob: nycDob,
};

const RESIDENTIAL_GLASS_SCOPE_REGEX = /\b(shower|enclosure|partition|frameless|bathroom|kitchen|plumbing|renovation|interior remodel|glass door|mirror|cabinet glass|cabinet)\b/;
const COMMERCIAL_GLASS_EXCLUSION_REGEX = /\b(storefront|awning|facade|exterior|commercial|glazing|retail|office|restaurant|hotel|lobby|gym|fitness|pool|curtain wall)\b/;

export const GLASS_RELEVANCE = {
  bathroom: 1.0,
  shower: 1.0,
  'bath remodel': 1.0,
  'master bath': 1.0,
  'glass partition': 1.0,
  'glass door': 1.0,
  'glass railing': 0.9,
  mirror: 0.9,
  storefront: 0.9,
  'wine room': 0.85,
  'display case': 0.8,
  'commercial fit-out': 0.85,
  'retail renovation': 0.85,
  'office renovation': 0.8,
  'hotel renovation': 0.8,
  'restaurant renovation': 0.8,
  'kitchen renovation': 0.7,
  'general renovation': 0.6,
  'interior alteration': 0.6,
  'apartment renovation': 0.6,
  'condo renovation': 0.6,
  'co-op renovation': 0.6,
  'full gut renovation': 0.5,
  'commercial alteration': 0.5,
  'lobby renovation': 0.5,
  gym: 0.4,
  spa: 0.4,
  'fitness center': 0.4,
  pool: 0.4,
  structural: 0.2,
  electrical: 0.1,
  plumbing: 0.15,
  hvac: 0.05,
  roofing: 0.05,
  facade: 0.15,
  'sidewalk shed': 0.0,
  scaffold: 0.0,
  demolition: 0.05,
  'fire alarm': 0.0,
  sprinkler: 0.0,
  boiler: 0.0,
  elevator: 0.0,
  antenna: 0.0,
  'solar panel': 0.0,
  sign: 0.1,
  gas: 0.05,
  'oil burner': 0.0,
  'curb cut': 0.0,
  crane: 0.0,
};

const DIRECT_KEYWORDS = METROGLASS_PROFILE.directKeywords.map((keyword) => normalizeText(keyword));
const INFERRED_KEYWORDS = METROGLASS_PROFILE.inferredKeywords.map((keyword) => normalizeText(keyword));
const NEGATIVE_KEYWORDS = METROGLASS_PROFILE.negativeKeywords.map((keyword) => normalizeText(keyword));

function countKeywordHits(text, keywords) {
  return keywords.filter((keyword) => text.includes(keyword));
}

export function scorePermitRelevance(workDescription) {
  if (!workDescription) {
    return { score: 0, keyword: null, matchType: 'none' };
  }

  const lower = normalizeText(workDescription);
  const residentialBoostMatch = lower.match(RESIDENTIAL_GLASS_SCOPE_REGEX);
  const exclusionMatch = lower.match(COMMERCIAL_GLASS_EXCLUSION_REGEX);

  if (exclusionMatch) {
    return {
      score: 0,
      keyword: exclusionMatch[0],
      matchType: 'negative',
    };
  }

  const directHits = countKeywordHits(lower, DIRECT_KEYWORDS);
  const inferredHits = countKeywordHits(lower, INFERRED_KEYWORDS);
  const negativeHits = countKeywordHits(lower, NEGATIVE_KEYWORDS);
  const matchedRule = PERMIT_RELEVANCE_RULES
    .filter((rule) => lower.includes(normalizeText(rule.keyword)))
    .sort((left, right) => right.score - left.score)[0] || null;

  let best = matchedRule?.score || 0;
  let keyword = matchedRule?.keyword || null;
  let matchType = matchedRule ? 'rule' : 'none';

  if (residentialBoostMatch) {
    best = Math.max(best, 0.95);
    keyword = keyword || residentialBoostMatch[0];
    matchType = matchedRule ? matchType : 'direct';
  }

  if (directHits.length >= 2) {
    best = Math.max(best, 0.9);
    keyword = keyword || directHits[0];
    matchType = matchedRule ? matchType : 'direct';
  } else if (directHits.length === 1) {
    best = Math.max(best, 0.75);
    keyword = keyword || directHits[0];
    matchType = matchedRule ? matchType : 'direct';
  } else if (inferredHits.length >= 2) {
    best = Math.max(best, 0.45);
    keyword = keyword || inferredHits[0];
    matchType = matchedRule ? matchType : 'inferred';
  } else if (inferredHits.length === 1) {
    best = Math.max(best, 0.3);
    keyword = keyword || inferredHits[0];
    matchType = matchedRule ? matchType : 'inferred';
  }

  for (const [candidate, score] of Object.entries(GLASS_RELEVANCE)) {
    if (!lower.includes(candidate) || score <= best) {
      continue;
    }
    best = score;
    keyword = candidate;
    matchType = 'rule';
  }

  if (negativeHits.length > 0 && directHits.length === 0 && (!matchedRule || matchedRule.score < 0.4)) {
    best = inferredHits.length > 0 ? Math.min(best, 0.2) : 0;
    keyword = keyword || negativeHits[0];
    matchType = best > 0 ? 'mixed' : 'negative';
  }

  return {
    score: best,
    keyword,
    matchType,
  };
}

function deriveQualityTier(relevanceScore) {
  if (relevanceScore >= 0.8) return 'hot';
  if (relevanceScore >= 0.4) return 'warm';
  return 'cold';
}

async function findDuplicateLead(db, permitKey, address, applicantName) {
  const exactLead = await db.single('v2_leads', {
    filters: [eq('permit_key', permitKey)],
  });

  if (exactLead) {
    return exactLead;
  }

  if (!address || !applicantName) {
    return null;
  }

  return db.single('v2_leads', {
    filters: [
      eq('address', address),
      eq('applicant_name', applicantName),
    ],
  });
}

async function recordDuplicatePermit(db, leadId, permit, relevance) {
  await db.insert('v2_related_permits', {
    lead_id: leadId,
    permit_number: permit.permit_number,
    work_description: permit.work_description,
    address: permit.address,
    relevance_score: relevance.score,
    relevance_keyword: relevance.keyword,
    raw_data: permit.raw_data,
  });
}

function isPermitKeyConflict(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('"code":"23505"')
    && message.includes('idx_v2_leads_permit_key');
}

async function ingestPermit(db, runId, permit, minThreshold) {
  const permitKey = buildPermitKey(permit.source, permit.permit_number);
  const relevance = scorePermitRelevance(permit.work_description);

  if (relevance.score < minThreshold) {
    return { skipped: true, reason: 'low_relevance' };
  }

  const duplicateLead = await findDuplicateLead(
    db,
    permitKey,
    normalizeWhitespace(permit.address),
    cleanCompanyName(permit.applicant_name),
  );

  if (duplicateLead) {
    await recordDuplicatePermit(db, duplicateLead.id, permit, relevance);
    await appendLeadEvent(db, {
      lead_id: duplicateLead.id,
      run_id: runId,
      event_type: 'duplicate_collapsed',
      detail: {
        permit_number: permit.permit_number,
        permit_key: permitKey,
      },
    });
    return { duplicate: true, leadId: duplicateLead.id, relevance };
  }

  let lead = null;

  try {
    [lead] = await db.insert('v2_leads', {
      permit_number: permit.permit_number,
      permit_key: permitKey,
      source: permit.source,
      address: normalizeWhitespace(permit.address),
      borough_or_municipality: permit.borough_or_municipality,
      state: permit.state || 'NY',
      work_description: permit.work_description,
      filing_date: permit.filing_date,
      permit_type: permit.permit_type,
      applicant_name: cleanCompanyName(permit.applicant_name),
      owner_name: cleanCompanyName(permit.owner_name),
      relevance_score: relevance.score,
      relevance_keyword: relevance.keyword,
      quality_tier: deriveQualityTier(relevance.score),
      status: 'new',
      updated_at: nowIso(),
    });
  } catch (error) {
    if (!isPermitKeyConflict(error)) {
      throw error;
    }

    const racedLead = await db.single('v2_leads', {
      filters: [eq('permit_key', permitKey)],
    });

    if (!racedLead) {
      throw error;
    }

    await recordDuplicatePermit(db, racedLead.id, permit, relevance);
    await appendLeadEvent(db, {
      lead_id: racedLead.id,
      run_id: runId,
      event_type: 'duplicate_collapsed',
      detail: {
        permit_number: permit.permit_number,
        permit_key: permitKey,
        reason: 'insert_conflict',
      },
    });

    return { duplicate: true, leadId: racedLead.id, relevance };
  }

  await appendLeadEvent(db, {
    lead_id: lead.id,
    run_id: runId,
    event_type: 'created',
    detail: {
      permit_number: permit.permit_number,
      source: permit.source,
    },
  });

  await appendLeadEvent(db, {
    lead_id: lead.id,
    run_id: runId,
    event_type: 'relevance_scored',
    detail: relevance,
  });

  return { created: true, leadId: lead.id, lead, relevance };
}

export async function runIngestStage(env, db, runId, config) {
  const activeSources = Array.isArray(config.active_sources) && config.active_sources.length > 0
    ? config.active_sources
    : ['nyc_dob'];
  const maxPermitsPerSource = Number(config.scan_limit_per_source || 0);
  const scanWindowDays = Math.max(1, Number(config.scan_window_days || 14));

  const since = new Date();
  since.setDate(since.getDate() - scanWindowDays);
  const sinceDay = since.toISOString().split('T')[0];

  const counters = {
    permits_found: 0,
    permits_skipped_low_relevance: 0,
    permits_deduplicated: 0,
    leads_created: 0,
  };

  const leadsToEnrich = [];

  for (const sourceId of activeSources) {
    const source = SOURCES[sourceId];
    if (!source) {
      continue;
    }

    const permits = await source.fetchPermits(sinceDay, { limit: maxPermitsPerSource });
    counters.permits_found += permits.length;

    for (const permit of permits) {
      const result = await ingestPermit(db, runId, permit, Number(config.min_relevance_threshold || 0.15));

      if (result.skipped) {
        counters.permits_skipped_low_relevance += 1;
        continue;
      }

      if (result.duplicate) {
        counters.permits_deduplicated += 1;
        continue;
      }

      if (result.created) {
        counters.leads_created += 1;
        if ((result.relevance?.score || 0) >= 0.4) {
          leadsToEnrich.push(result.leadId);
        }
      }
    }
  }

  return {
    counters,
    leadsToEnrich,
  };
}
