import {
  claimPendingAutomationLeads,
  countPendingAutomationLeads,
  getClaimedLeadIdsForRun,
  listPendingAutomationLeads,
  markLeadAutomationProcessed,
  releaseAutomationLeadClaim,
  releaseClaimedLeadsForRuns,
  summarizeRunQueue,
} from '../lib/automation-queue.mjs';
import { getAppConfig } from '../lib/config.mjs';
import { withJob } from '../lib/jobs.mjs';
import {
  completeRun,
  createRun,
  expireStaleRuns,
  failRun,
  getRunningRun,
  updateRun,
  updateRunStage,
} from '../lib/runs.mjs';
import {
  createSupabaseClient,
  eq,
  gte,
  order,
  withTenantScope,
} from '../lib/supabase.mjs';
import { discoverLeadContacts } from './contacts.mjs';
import { generateLeadDraft } from './draft.mjs';
import { processDueFollowUps } from './follow-up.mjs';
import { harvestFreshLeads } from './ingest.mjs';
import { resolveLeadCompany } from './resolve.mjs';
import { selectLeadRoute } from './route.mjs';
import { scoreLeadEmails } from './score.mjs';
import { sendReadyLeads } from './send.mjs';

const OPERATOR_RAW_FETCH_BUDGET = 1000;
const OPERATOR_HARVEST_SLICE = 200;
const OPERATOR_PROCESS_SLICE = 12;
const SCHEDULE_RAW_FETCH_BUDGET = 2000;
const SCHEDULE_HARVEST_SLICE = 250;
const SCHEDULE_PROCESS_SLICE = 20;

function emptyCounters() {
  return {
    permits_found: 0,
    permits_skipped_low_relevance: 0,
    permits_deduplicated: 0,
    leads_created: 0,
    leads_enriched: 0,
    leads_ready: 0,
    leads_review: 0,
    drafts_generated: 0,
    sends_attempted: 0,
    sends_succeeded: 0,
    sends_failed: 0,
  };
}

function startOfDayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

async function countSentToday(db) {
  const rows = await db.select('v2_email_outcomes', {
    columns: 'id',
    filters: [eq('outcome', 'sent'), `sent_at=gte.${encodeURIComponent(startOfDayIso())}`],
  });
  return rows.length;
}

function getDailyCap(config) {
  return config.warm_up_mode
    ? Number(config.warm_up_daily_cap || 5)
    : Number(config.daily_send_cap || 20);
}

function computeTargetClaimCount(remainingDailyCap) {
  return Math.min(Math.max(Math.max(0, remainingDailyCap) * 3, 30), 150);
}

function normalizeLeadIds(values, max = 50) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))].slice(0, max);
}

function dedupeIds(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function addCounters(target, patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in target) {
      target[key] = Number(target[key] || 0) + Number(value || 0);
    }
  }
}

function withRuntimeOverrides(config, options = {}) {
  const nextConfig = { ...config };

  if (options.mode === 'operator_scan') {
    const currentSourceLimit = Number(nextConfig.scan_limit_per_source || 0);
    nextConfig.scan_limit_per_source = currentSourceLimit > 0
      ? Math.min(currentSourceLimit, OPERATOR_RAW_FETCH_BUDGET)
      : OPERATOR_RAW_FETCH_BUDGET;
  }

  return nextConfig;
}

function scopedAutomationDb(env, tenant = null) {
  const db = createSupabaseClient(env);
  return tenant?.id ? withTenantScope(db, tenant.id) : db;
}

function normalizeRunScope(run, config = {}, options = {}) {
  const sourceScope = run && run.source_scope && typeof run.source_scope === 'object' && !Array.isArray(run.source_scope)
    ? run.source_scope
    : {
        active_sources: Array.isArray(run?.source_scope)
          ? run.source_scope
          : (Array.isArray(config.active_sources) && config.active_sources.length > 0 ? config.active_sources : ['nyc_dob']),
      };
  const progress = sourceScope.progress && typeof sourceScope.progress === 'object'
    ? sourceScope.progress
    : {};
  const mode = sourceScope.mode || options.mode || 'automation';

  return {
    ...sourceScope,
    mode,
    active_sources: Array.isArray(sourceScope.active_sources) && sourceScope.active_sources.length > 0
      ? sourceScope.active_sources
      : (Array.isArray(config.active_sources) && config.active_sources.length > 0 ? config.active_sources : ['nyc_dob']),
    harvest_offsets: sourceScope.harvest_offsets && typeof sourceScope.harvest_offsets === 'object'
      ? sourceScope.harvest_offsets
      : {},
    exhausted_sources: Array.isArray(sourceScope.exhausted_sources) ? sourceScope.exhausted_sources : [],
    fresh_inserted: Number(sourceScope.fresh_inserted || 0),
    target_claim_count: Number(sourceScope.target_claim_count || 0),
    backlog_pending_at_start: Number(sourceScope.backlog_pending_at_start || 0),
    raw_fetch_budget: Number(sourceScope.raw_fetch_budget || 0),
    raw_permits_scanned: Number(sourceScope.raw_permits_scanned || 0),
    harvest_slice_size: Number(sourceScope.harvest_slice_size || 0),
    process_slice_size: Number(sourceScope.process_slice_size || 0),
    claimed_lead_ids: dedupeIds(sourceScope.claimed_lead_ids || []),
    processed_lead_ids: dedupeIds(sourceScope.processed_lead_ids || []),
    progress: {
      backlog_pending: Number(progress.backlog_pending || 0),
      claimed: Number(progress.claimed || 0),
      processed: Number(progress.processed || 0),
      fresh_inserted: Number(progress.fresh_inserted || sourceScope.fresh_inserted || 0),
      remaining: Number(progress.remaining || 0),
      ready: Number(progress.ready || 0),
      review: Number(progress.review || 0),
      email_required: Number(progress.email_required || 0),
      archived: Number(progress.archived || 0),
      sent: Number(progress.sent || 0),
    },
  };
}

async function buildRunScope(db, config, options = {}) {
  const sentToday = await countSentToday(db);
  const cap = getDailyCap(config);
  const remainingDailyCap = Math.max(cap - sentToday, 0);
  const backlogPendingAtStart = await countPendingAutomationLeads(db);
  const targetClaimCount = computeTargetClaimCount(remainingDailyCap);
  const operatorMode = options.mode === 'operator_scan';

  return {
    mode: options.mode || 'automation',
    active_sources: Array.isArray(config.active_sources) && config.active_sources.length > 0 ? config.active_sources : ['nyc_dob'],
    target_claim_count: targetClaimCount,
    backlog_pending_at_start: backlogPendingAtStart,
    remaining_daily_cap: remainingDailyCap,
    raw_fetch_budget: operatorMode ? OPERATOR_RAW_FETCH_BUDGET : SCHEDULE_RAW_FETCH_BUDGET,
    raw_permits_scanned: 0,
    harvest_slice_size: operatorMode ? OPERATOR_HARVEST_SLICE : SCHEDULE_HARVEST_SLICE,
    process_slice_size: operatorMode ? OPERATOR_PROCESS_SLICE : SCHEDULE_PROCESS_SLICE,
    harvest_offsets: {},
    exhausted_sources: [],
    fresh_inserted: 0,
    claimed_lead_ids: [],
    processed_lead_ids: [],
    progress: {
      backlog_pending: backlogPendingAtStart,
      claimed: 0,
      processed: 0,
      fresh_inserted: 0,
      remaining: targetClaimCount,
      ready: 0,
      review: 0,
      email_required: 0,
      archived: 0,
      sent: 0,
    },
  };
}

async function refreshRunScopeProgress(db, runId, scope) {
  const [backlogPending, queueSummary] = await Promise.all([
    countPendingAutomationLeads(db),
    summarizeRunQueue(db, runId, {
      claimedLeadIds: scope.claimed_lead_ids,
      processedLeadIds: scope.processed_lead_ids,
    }),
  ]);

  return {
    ...scope,
    progress: {
      ...scope.progress,
      backlog_pending: backlogPending,
      claimed: queueSummary.claimed,
      processed: queueSummary.processed,
      fresh_inserted: Number(scope.fresh_inserted || 0),
      remaining: Math.max(Number(scope.target_claim_count || 0) - queueSummary.processed, 0),
      ready: queueSummary.ready,
      review: queueSummary.review,
      email_required: queueSummary.email_required,
      archived: queueSummary.archived,
      sent: queueSummary.sent,
    },
  };
}

async function persistRunState(db, runId, stage, counters, scope, extraPatch = {}) {
  return updateRunStage(db, runId, stage, counters, {
    source_scope: scope,
    ...extraPatch,
  });
}

async function expireAndReleaseStaleRuns(db, options = {}) {
  const staleRuns = await expireStaleRuns(db, options);
  const staleRunIds = staleRuns.map((run) => run.id).filter(Boolean);
  if (staleRunIds.length > 0) {
    await releaseClaimedLeadsForRuns(db, staleRunIds);
  }
  return staleRuns;
}

async function processLeadStages(env, db, runId, leadId, counters, config, saveStage, tenant = null) {
  await saveStage('resolve', counters);
  await withJob(db, leadId, runId, 'resolve_company', 'resolver', async () => (
    resolveLeadCompany(env, db, runId, leadId)
  ));

  await saveStage('enrich', counters);
  await withJob(db, leadId, runId, 'discover_contacts', 'firecrawl', async () => (
    discoverLeadContacts(env, db, runId, leadId)
  ));

  await saveStage('score', counters);
  await withJob(db, leadId, runId, 'score_emails', 'dns', async () => (
    scoreLeadEmails(env, db, runId, leadId, config)
  ));

  await saveStage('route', counters);
  const routedLead = await withJob(db, leadId, runId, 'select_route', 'internal', async () => (
    selectLeadRoute(db, runId, leadId)
  ));

  counters.leads_enriched += 1;
  if (routedLead?.status === 'ready') {
    counters.leads_ready += 1;
  } else if (routedLead?.status && routedLead.status !== 'sent') {
    counters.leads_review += 1;
  }

  if (!routedLead || !['ready', 'review'].includes(routedLead.status)) {
    return routedLead;
  }

  await saveStage('draft', counters);
  const draft = await withJob(db, leadId, runId, 'generate_draft', 'internal', async () => (
    generateLeadDraft(db, tenant, runId, leadId)
  ));

  if (draft) {
    counters.drafts_generated += 1;
  }

  return routedLead;
}

async function fillRunQueue(env, db, runId, config, counters, scope) {
  let claimedLeadIds = await getClaimedLeadIdsForRun(db, runId, {
    onlyPending: true,
    fallbackIds: scope.claimed_lead_ids,
  });

  if (claimedLeadIds.length < scope.target_claim_count) {
    const initialClaims = await claimPendingAutomationLeads(db, runId, scope.target_claim_count - claimedLeadIds.length, {
      excludeLeadIds: claimedLeadIds,
    });
    claimedLeadIds = dedupeIds([...claimedLeadIds, ...initialClaims]);
  }

  scope = {
    ...scope,
    claimed_lead_ids: claimedLeadIds,
  };
  scope = await refreshRunScopeProgress(db, runId, scope);
  await persistRunState(db, runId, claimedLeadIds.length > 0 ? 'claim' : 'harvest', counters, scope);

  while (claimedLeadIds.length < scope.target_claim_count) {
    const rawBudgetRemaining = Math.max(Number(scope.raw_fetch_budget || 0) - Number(scope.raw_permits_scanned || 0), 0);
    if (rawBudgetRemaining <= 0) {
      break;
    }

    const harvestSliceBudget = Math.min(Number(scope.harvest_slice_size || OPERATOR_HARVEST_SLICE), rawBudgetRemaining);
    if (harvestSliceBudget <= 0) {
      break;
    }

    await persistRunState(db, runId, 'harvest', counters, scope);
    const harvest = await withJob(db, null, runId, 'ingest', 'nyc_dob', async () => (
      harvestFreshLeads(env, db, runId, config, {
        rawPermitBudget: harvestSliceBudget,
        targetLeadCount: scope.target_claim_count - claimedLeadIds.length,
        offsets: scope.harvest_offsets,
        pageSize: scope.harvest_slice_size,
      })
    ));

    addCounters(counters, harvest.counters);
    scope = {
      ...scope,
      harvest_offsets: harvest.offsets,
      exhausted_sources: dedupeIds([...(scope.exhausted_sources || []), ...(harvest.exhaustedSources || [])]),
      raw_permits_scanned: Number(scope.raw_permits_scanned || 0) + Number(harvest.counters?.permits_found || 0),
      fresh_inserted: Number(scope.fresh_inserted || 0) + Number(harvest.leadsCreated?.length || 0),
      progress: {
        ...scope.progress,
        fresh_inserted: Number(scope.fresh_inserted || 0) + Number(harvest.leadsCreated?.length || 0),
      },
    };

    const claimedAfterHarvest = await claimPendingAutomationLeads(db, runId, scope.target_claim_count - claimedLeadIds.length, {
      excludeLeadIds: claimedLeadIds,
    });
    claimedLeadIds = dedupeIds([...claimedLeadIds, ...claimedAfterHarvest]);

    scope = {
      ...scope,
      claimed_lead_ids: claimedLeadIds,
    };
    scope = await refreshRunScopeProgress(db, runId, scope);
    await persistRunState(db, runId, 'claim', counters, scope);

    const exhaustedAllSources = Array.isArray(scope.active_sources)
      && scope.exhausted_sources.length >= scope.active_sources.length;
    if (claimedAfterHarvest.length === 0 && Number(harvest.leadsCreated?.length || 0) === 0 && exhaustedAllSources) {
      break;
    }
  }

  return {
    claimedLeadIds,
    scope,
  };
}

async function executeAutomationRun(env, db, run, config, options = {}) {
  const counters = emptyCounters();
  let scope = normalizeRunScope(run, config, options);
  const claimedLeadIds = [];
  const processedLeadIds = [];
  let errorCount = Number(run.error_count || 0);

  scope = await refreshRunScopeProgress(db, run.id, scope);
  await persistRunState(db, run.id, 'claim', counters, scope);

  const queueFill = await fillRunQueue(env, db, run.id, config, counters, scope);
  scope = queueFill.scope;
  claimedLeadIds.push(...queueFill.claimedLeadIds);

  const processSliceSize = Math.max(5, Number(scope.process_slice_size || OPERATOR_PROCESS_SLICE));
  const saveStage = async (stage) => {
    await persistRunState(db, run.id, stage, counters, scope, { error_count: errorCount });
  };

  for (let index = 0; index < claimedLeadIds.length; index += processSliceSize) {
    const slice = claimedLeadIds.slice(index, index + processSliceSize);

    for (const leadId of slice) {
      try {
        await processLeadStages(env, db, run.id, leadId, counters, config, saveStage, options.tenant || null);
        await markLeadAutomationProcessed(db, leadId, run.id);
        processedLeadIds.push(leadId);
        scope = {
          ...scope,
          processed_lead_ids: dedupeIds([...scope.processed_lead_ids, leadId]),
        };
      } catch (error) {
        errorCount += 1;
        await releaseAutomationLeadClaim(db, leadId);
        scope = {
          ...scope,
          last_error_message: error instanceof Error ? error.message : String(error || 'Lead processing failed'),
        };
        await updateRun(db, run.id, {
          error_count: errorCount,
          last_error: scope.last_error_message,
          source_scope: scope,
        });
      }

      scope = await refreshRunScopeProgress(db, run.id, scope);
      await persistRunState(db, run.id, 'process', counters, scope, { error_count: errorCount });
    }
  }

  await persistRunState(db, run.id, 'send', counters, scope, { error_count: errorCount });
  const sendResult = await withJob(db, null, run.id, 'send', 'gmail', async () => (
    sendReadyLeads(env, db, run.id, config, {
      leadIds: processedLeadIds,
      tenant: options.tenant || null,
    })
  ));

  counters.sends_attempted = sendResult.attempted;
  counters.sends_succeeded = sendResult.succeeded;
  counters.sends_failed = sendResult.failed;

  if (!options.skipFollowUps) {
    await persistRunState(db, run.id, 'follow_up', counters, scope, { error_count: errorCount });
    await withJob(db, null, run.id, 'follow_up', 'gmail', async () => (
      processDueFollowUps(env, db, {
        tenant: options.tenant || null,
      })
    ));
  }

  scope = await refreshRunScopeProgress(db, run.id, scope);
  await completeRun(db, run.id, {
    ...counters,
    error_count: errorCount,
  }, {
    source_scope: scope,
  });

  return {
    run_id: run.id,
    status: 'completed',
    target_claim_count: scope.target_claim_count,
    backlog_pending_at_start: scope.backlog_pending_at_start,
    counts: {
      ...counters,
      ready: counters.leads_ready,
      review: counters.leads_review,
      enriched: counters.leads_enriched,
      drafted: counters.drafts_generated,
      claimed: scope.progress.claimed,
      processed: scope.progress.processed,
      fresh_inserted: scope.progress.fresh_inserted,
    },
  };
}

async function getQueuedLeadIds(db, excludedLeadIds = [], limit = 10, minRelevance = 0.15) {
  let queued;
  try {
    queued = await db.select('v2_leads', {
      columns: 'id',
      filters: [eq('status', 'new'), eq('automation_state', 'pending'), gte('relevance_score', minRelevance)],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit,
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error || '');
    if (!message.includes('automation_state') && !message.includes('42703')) {
      throw error;
    }
    queued = await db.select('v2_leads', {
      columns: 'id',
      filters: [eq('status', 'new'), gte('relevance_score', minRelevance)],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit,
    });
  }

  return queued
    .map((row) => row.id)
    .filter((leadId) => leadId && !excludedLeadIds.includes(leadId));
}

export async function startAutomationCycle(env, options = {}) {
  const tenant = options.tenant || null;
  const db = scopedAutomationDb(env, tenant);
  await expireAndReleaseStaleRuns(db, {
    staleAfterMinutes: (options.triggerType || 'operator') === 'operator' ? 5 : 10,
  });
  const config = withRuntimeOverrides(await getAppConfig(db, tenant?.id || null), options);
  const runningRun = await getRunningRun(db);

  if (runningRun) {
    return {
      run: runningRun,
      task: null,
      activeRunReused: true,
    };
  }

  const scope = await buildRunScope(db, config, options);
  const run = await createRun(
    db,
    options.triggerType || 'operator',
    options.triggeredBy || null,
    config,
    scope,
  );

  const task = executeAutomationRun(env, db, run, config, {
    skipFollowUps: Boolean(options.skipFollowUps),
    mode: options.mode,
    tenant,
  }).catch(async (error) => {
    await failRun(db, run.id, error);
    await releaseClaimedLeadsForRuns(db, [run.id]);
    throw error;
  });

  return {
    run: {
      ...run,
      source_scope: scope,
    },
    task,
    activeRunReused: false,
  };
}

export async function runAutomationCycle(env, options = {}) {
  const { task } = await startAutomationCycle(env, options);
  return task ?? {
    status: 'running',
  };
}

export async function enrichLead(env, leadId, options = {}) {
  const tenant = options.tenant || null;
  const db = scopedAutomationDb(env, tenant);
  const config = await getAppConfig(db, tenant?.id || null);
  const run = await createRun(
    db,
    options.triggerType || 'retry',
    options.triggeredBy || null,
    config,
    {
      mode: 'single_lead',
      lead_id: leadId,
      active_sources: config.active_sources,
      target_claim_count: 1,
      backlog_pending_at_start: await countPendingAutomationLeads(db),
      claimed_lead_ids: [leadId],
      processed_lead_ids: [],
      progress: {
        backlog_pending: await countPendingAutomationLeads(db),
        claimed: 1,
        processed: 0,
        fresh_inserted: 0,
        remaining: 1,
      },
    },
  );

  const counters = emptyCounters();
  let scope = normalizeRunScope(run, config, { mode: 'single_lead' });

  try {
    const saveStage = async (stage) => {
      await persistRunState(db, run.id, stage, counters, scope);
    };
    await processLeadStages(env, db, run.id, leadId, counters, config, saveStage, tenant);
    await markLeadAutomationProcessed(db, leadId, run.id);
    scope = {
      ...scope,
      processed_lead_ids: dedupeIds([...scope.processed_lead_ids, leadId]),
    };
    scope = await refreshRunScopeProgress(db, run.id, scope);
    await completeRun(db, run.id, counters, { source_scope: scope });
    return {
      run_id: run.id,
      lead_id: leadId,
      status: 'completed',
      counts: counters,
    };
  } catch (error) {
    await failRun(db, run.id, error, counters, { source_scope: scope });
    throw error;
  }
}

async function executeLeadBatchAutomation(env, db, run, config, leadIds = [], tenant = null) {
  const counters = emptyCounters();
  const targetLeadIds = normalizeLeadIds(leadIds, 50);
  let scope = normalizeRunScope(run, config, { mode: 'selected_leads' });

  const saveStage = async (stage) => {
    await persistRunState(db, run.id, stage, counters, scope);
  };

  for (const leadId of targetLeadIds) {
    await processLeadStages(env, db, run.id, leadId, counters, config, saveStage, tenant);
    await markLeadAutomationProcessed(db, leadId, run.id);
    scope = {
      ...scope,
      processed_lead_ids: dedupeIds([...scope.processed_lead_ids, leadId]),
    };
  }

  await persistRunState(db, run.id, 'send', counters, scope);
  const sendResult = await withJob(db, null, run.id, 'send', 'gmail', async () => (
    sendReadyLeads(env, db, run.id, config, {
      leadIds: targetLeadIds,
      tenant,
    })
  ));

  counters.sends_attempted = sendResult.attempted;
  counters.sends_succeeded = sendResult.succeeded;
  counters.sends_failed = sendResult.failed;

  scope = await refreshRunScopeProgress(db, run.id, scope);
  await completeRun(db, run.id, counters, { source_scope: scope });

  return {
    run_id: run.id,
    accepted: targetLeadIds.length,
    status: 'completed',
    counts: counters,
  };
}

export async function startLeadBatchAutomation(env, leadIds = [], options = {}) {
  const tenant = options.tenant || null;
  const db = scopedAutomationDb(env, tenant);
  await expireAndReleaseStaleRuns(db, {
    staleAfterMinutes: 5,
  });
  const config = await getAppConfig(db, tenant?.id || null);
  let normalizedLeadIds = normalizeLeadIds(leadIds, 50);
  if (normalizedLeadIds.length === 0) {
    normalizedLeadIds = await getQueuedLeadIds(db, [], 50, Number(config.min_relevance_threshold || 0.15));
  }

  const run = await createRun(
    db,
    options.triggerType || 'operator',
    options.triggeredBy || null,
    config,
    normalizedLeadIds.length > 0
      ? { mode: 'selected_leads', lead_ids: normalizedLeadIds, claimed_lead_ids: normalizedLeadIds, processed_lead_ids: [] }
      : { mode: 'new_leads', claimed_lead_ids: [], processed_lead_ids: [] },
  );

  const task = executeLeadBatchAutomation(env, db, run, config, normalizedLeadIds, tenant).catch(async (error) => {
    await failRun(db, run.id, error);
    throw error;
  });

  return {
    run,
    accepted: normalizedLeadIds.length,
    task,
  };
}

export async function getRunById(env, runId, tenantId = null) {
  const rootDb = createSupabaseClient(env);
  const db = tenantId ? withTenantScope(rootDb, tenantId) : rootDb;
  await expireAndReleaseStaleRuns(db, {
    staleAfterMinutes: 5,
  });
  return db.single('v2_automation_runs', {
    filters: [eq('id', runId)],
  });
}

export async function getLatestRuns(env, tenantId = null) {
  const rootDb = createSupabaseClient(env);
  const db = tenantId ? withTenantScope(rootDb, tenantId) : rootDb;
  await expireAndReleaseStaleRuns(db, {
    staleAfterMinutes: 5,
  });
  const [currentRun, lastRun] = await Promise.all([
    db.single('v2_automation_runs', {
      filters: [eq('status', 'running')],
      ordering: [order('created_at', 'desc')],
    }),
    db.single('v2_automation_runs', {
      ordering: [order('created_at', 'desc')],
    }),
  ]);
  return { currentRun, lastRun };
}

export async function getAutomationBacklogPreview(env, limit = 10) {
  const db = createSupabaseClient(env);
  const [pendingCount, pendingLeads] = await Promise.all([
    countPendingAutomationLeads(db),
    listPendingAutomationLeads(db, limit),
  ]);

  return {
    pendingCount,
    pendingLeads,
  };
}
