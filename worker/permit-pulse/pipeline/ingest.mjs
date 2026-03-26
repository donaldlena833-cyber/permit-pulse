import nycDob from '../sources/nyc-dob.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';
import {
  buildPermitKey,
  cleanCompanyName,
  nowIso,
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

export function scorePermitRelevance(workDescription) {
  if (!workDescription) {
    return { score: 0.3, keyword: null };
  }

  const lower = workDescription.toLowerCase();
  let best = 0;
  let keyword = null;

  for (const [candidate, score] of Object.entries(GLASS_RELEVANCE)) {
    if (lower.includes(candidate) && score > best) {
      best = score;
      keyword = candidate;
    }
  }

  return { score: best || 0.3, keyword };
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

  const [lead] = await db.insert('v2_leads', {
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
  const maxPermitsPerSource = 10;

  const since = new Date();
  since.setDate(since.getDate() - 14);
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
