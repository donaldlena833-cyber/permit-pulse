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
const ARCHITECT_SIGNAL_TERMS = ['architect', 'architects', 'architecture', 'design', 'designer', 'interior', 'interiors', 'studio', 'atelier'];
const RESIDENTIAL_SCOPE_PATTERN = /bathroom|kitchen|renovation|remodel|interior|apartment|condo|co-op|shower|partition|mirror|cabinet|plumbing/i;
const WIDER_INTERIOR_SCOPE_PATTERN = /bathroom|kitchen|renovation|remodel|alteration|interior|apartment|condo|co-op|partition|door|mirror|cabinet|finish|fixture|tile|millwork|residential|dwelling|plumbing/i;
const DEFAULT_SOURCE_FETCH_LIMIT = 400;
const DEFAULT_ENRICH_PER_RUN_LIMIT = 150;
const DEFAULT_PAGE_SIZE = 200;
const HARD_EXCLUDED_PERMIT_TYPES = [
  'sidewalk shed',
  'construction fence',
  'supported scaffold',
  'suspended scaffold',
  'sprinklers',
  'standpipe',
  'solar',
  'curb cut',
  'antenna',
  'boiler equipment',
  'full demolition',
  'protection and mechanical methods',
  'earth work',
  'foundation',
  'support of excavation',
];
const CONDITIONAL_PERMIT_TYPES = ['plumbing', 'mechanical systems', 'structural'];

function countKeywordHits(text, keywords) {
  return keywords.filter((keyword) => text.includes(keyword));
}

function hasArchitectSignal(...values) {
  const searchable = normalizeText(values.join(' '));
  return ARCHITECT_SIGNAL_TERMS.some((token) => searchable.includes(token));
}

export function scorePermitRelevance(input) {
  const permit = input && typeof input === 'object' ? input : null;
  const workDescription = permit?.work_description ?? input;
  if (!workDescription) {
    return { score: 0, keyword: null, matchType: 'none' };
  }

  const lower = normalizeText(workDescription);
  const permitType = normalizeText(permit?.permit_type || '');
  if (permitType && HARD_EXCLUDED_PERMIT_TYPES.some((candidate) => permitType.includes(candidate))) {
    return { score: 0, keyword: permit?.permit_type || null, matchType: 'negative' };
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

  if (permit) {
    const architectFocused = hasArchitectSignal(permit.applicant_name, permit.owner_name);
    const conditionalPermitType = CONDITIONAL_PERMIT_TYPES.some((candidate) => permitType.includes(candidate));

    if (permitType.includes('general construction') && WIDER_INTERIOR_SCOPE_PATTERN.test(lower) && architectFocused) {
      const boosted = Math.max(best, 0.45);
      if (boosted > best) {
        best = boosted;
        keyword = keyword || 'architect';
        matchType = matchType === 'none' ? 'inferred' : matchType;
      }
    } else if (permitType.includes('plumbing') && WIDER_INTERIOR_SCOPE_PATTERN.test(lower)) {
      const boosted = Math.max(best, architectFocused ? 0.4 : 0.25);
      if (boosted > best) {
        best = boosted;
        keyword = keyword || 'plumbing';
        matchType = matchType === 'none' ? 'inferred' : matchType;
      }
    } else if (architectFocused && conditionalPermitType && WIDER_INTERIOR_SCOPE_PATTERN.test(lower)) {
      const boosted = Math.max(best, 0.22);
      if (boosted > best) {
        best = boosted;
        keyword = keyword || 'architect';
        matchType = matchType === 'none' ? 'inferred' : matchType;
      }
    }

    if (architectFocused && RESIDENTIAL_SCOPE_PATTERN.test(lower)) {
      const boosted = best > 0 ? Math.min(best + 0.15, 0.95) : 0.35;
      if (boosted > best) {
        best = boosted;
        keyword = keyword || 'architect';
        if (matchType === 'none') {
          matchType = 'inferred';
        }
      }
    } else if (architectFocused && WIDER_INTERIOR_SCOPE_PATTERN.test(lower)) {
      const boosted = Math.max(best, 0.18);
      if (boosted > best) {
        best = boosted;
        keyword = keyword || 'architect';
        if (matchType === 'none') {
          matchType = 'inferred';
        }
      }
    } else if (architectFocused && best >= 0.3) {
      best = Math.min(best + 0.1, 0.9);
      keyword = keyword || 'architect';
    }
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

function isDuplicatePermitInsertError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('23505')
    && message.includes('idx_v2_leads_permit_key');
}

function isMissingAutomationQueueColumnError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('automation_state')
    || message.includes('automation_claimed_by_run')
    || message.includes('automation_claimed_at')
    || message.includes('automation_processed_at')
    || message.includes('42703');
}

async function ingestPermit(db, runId, permit, minThreshold) {
  const permitKey = buildPermitKey(permit.source, permit.permit_number);
  const relevance = scorePermitRelevance(permit);

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

  const leadPayload = {
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
    automation_state: 'pending',
    automation_claimed_by_run: null,
    automation_claimed_at: null,
    automation_processed_at: null,
    updated_at: nowIso(),
  };

  let lead;
  try {
    [lead] = await db.insert('v2_leads', leadPayload);
  } catch (error) {
    if (isMissingAutomationQueueColumnError(error)) {
      const {
        automation_state: _automationState,
        automation_claimed_by_run: _automationClaimedByRun,
        automation_claimed_at: _automationClaimedAt,
        automation_processed_at: _automationProcessedAt,
        ...legacyLeadPayload
      } = leadPayload;
      [lead] = await db.insert('v2_leads', legacyLeadPayload);
    } else {
      if (!isDuplicatePermitInsertError(error)) {
        throw error;
      }

      const racedDuplicate = await findDuplicateLead(
        db,
        permitKey,
        normalizeWhitespace(permit.address),
        cleanCompanyName(permit.applicant_name),
      );

      if (!racedDuplicate) {
        throw error;
      }

      await recordDuplicatePermit(db, racedDuplicate.id, permit, relevance);
      await appendLeadEvent(db, {
        lead_id: racedDuplicate.id,
        run_id: runId,
        event_type: 'duplicate_collapsed',
        detail: {
          permit_number: permit.permit_number,
          permit_key: permitKey,
        },
      });
      return { duplicate: true, leadId: racedDuplicate.id, relevance };
    }
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

export function calculateSinceDay(config = {}) {
  const scanWindowDays = Math.max(1, Number(config.scan_window_days || 14));
  const since = new Date();
  since.setDate(since.getDate() - scanWindowDays);
  return since.toISOString().split('T')[0];
}

export async function harvestFreshLeads(env, db, runId, config, options = {}) {
  const activeSources = Array.isArray(config.active_sources) && config.active_sources.length > 0
    ? config.active_sources
    : ['nyc_dob'];
  const sinceDay = options.sinceDay || calculateSinceDay(config);
  const rawPermitBudget = Math.max(0, Number(options.rawPermitBudget || DEFAULT_SOURCE_FETCH_LIMIT));
  const targetLeadCount = Math.max(0, Number(options.targetLeadCount || DEFAULT_ENRICH_PER_RUN_LIMIT));
  const pageSize = Math.max(50, Math.min(Number(options.pageSize || DEFAULT_PAGE_SIZE), 500));
  const minThreshold = Number(config.min_relevance_threshold || 0.15);
  const offsets = { ...(options.offsets || {}) };

  const counters = {
    permits_found: 0,
    permits_skipped_low_relevance: 0,
    permits_deduplicated: 0,
    leads_created: 0,
  };

  const leadsCreated = [];
  const exhaustedSources = [];

  for (const sourceId of activeSources) {
    const source = SOURCES[sourceId];
    if (!source) {
      exhaustedSources.push(sourceId);
      continue;
    }

    let offset = Math.max(0, Number(offsets[sourceId] || 0));
    let sourceExhausted = false;

    while (counters.permits_found < rawPermitBudget && leadsCreated.length < targetLeadCount) {
      const remainingRawBudget = rawPermitBudget - counters.permits_found;
      const fetchLimit = Math.min(pageSize, remainingRawBudget);
      if (fetchLimit <= 0) {
        break;
      }

      const permits = await source.fetchPermits(sinceDay, {
        limit: fetchLimit,
        offset,
      });

      counters.permits_found += permits.length;
      offset += permits.length;
      offsets[sourceId] = offset;

      if (typeof options.onProgress === 'function') {
        await options.onProgress({ ...counters }, { offsets: { ...offsets }, leadsCreated: [...leadsCreated] });
      }

      if (permits.length === 0) {
        sourceExhausted = true;
        break;
      }

      for (let index = 0; index < permits.length; index += 1) {
        const result = await ingestPermit(db, runId, permits[index], minThreshold);

        if (result.skipped) {
          counters.permits_skipped_low_relevance += 1;
        } else if (result.duplicate) {
          counters.permits_deduplicated += 1;
        } else if (result.created) {
          counters.leads_created += 1;
          leadsCreated.push(result.leadId);
        }

        if (typeof options.onProgress === 'function' && (index === permits.length - 1 || index % 25 === 24)) {
          await options.onProgress({ ...counters }, { offsets: { ...offsets }, leadsCreated: [...leadsCreated] });
        }

        if (leadsCreated.length >= targetLeadCount) {
          break;
        }
      }

      if (permits.length < fetchLimit || permits.length < pageSize) {
        sourceExhausted = true;
        break;
      }
    }

    if (sourceExhausted) {
      exhaustedSources.push(sourceId);
    }

    if (counters.permits_found >= rawPermitBudget || leadsCreated.length >= targetLeadCount) {
      break;
    }
  }

  return {
    counters,
    leadsCreated,
    offsets,
    exhaustedSources,
  };
}

export async function runIngestStage(env, db, runId, config, onProgress = null) {
  const activeSources = Array.isArray(config.active_sources) && config.active_sources.length > 0
    ? config.active_sources
    : ['nyc_dob'];
  const configuredPermitsPerSource = Number(config.scan_limit_per_source || 0);
  const maxPermitsPerSource = configuredPermitsPerSource > 0 ? configuredPermitsPerSource : DEFAULT_SOURCE_FETCH_LIMIT;
  const maxLeadsToEnrichPerRun = Math.max(25, Number(config.max_leads_to_enrich_per_run || DEFAULT_ENRICH_PER_RUN_LIMIT));
  const harvest = await harvestFreshLeads(env, db, runId, {
    ...config,
    active_sources: activeSources,
  }, {
    sinceDay: calculateSinceDay(config),
    rawPermitBudget: maxPermitsPerSource,
    targetLeadCount: maxLeadsToEnrichPerRun,
    onProgress,
  });

  return {
    counters: harvest.counters,
    leadsToEnrich: harvest.leadsCreated,
  };
}
