import { createSupabaseClient, eq, gte, order } from '../lib/supabase.mjs';
import { getAppConfig } from '../lib/config.mjs';
import { withJob } from '../lib/jobs.mjs';
import { completeRun, createRun, failRun, heartbeatRun, updateRunStage } from '../lib/runs.mjs';
import { discoverLeadContacts } from './contacts.mjs';
import { generateLeadDraft } from './draft.mjs';
import { processDueFollowUps } from './follow-up.mjs';
import { runIngestStage } from './ingest.mjs';
import { resolveLeadCompany } from './resolve.mjs';
import { selectLeadRoute } from './route.mjs';
import { scoreLeadEmails } from './score.mjs';
import { sendReadyLeads } from './send.mjs';

async function processLeadStages(env, db, runId, leadId, counters) {
  await heartbeatRun(db, runId);
  await updateRunStage(db, runId, 'resolve', counters);
  await withJob(db, leadId, runId, 'resolve_company', 'resolver', async () => (
    resolveLeadCompany(env, db, runId, leadId)
  ));

  await heartbeatRun(db, runId);
  await updateRunStage(db, runId, 'enrich', counters);
  await withJob(db, leadId, runId, 'discover_contacts', 'firecrawl', async () => (
    discoverLeadContacts(env, db, runId, leadId)
  ));

  await heartbeatRun(db, runId);
  await updateRunStage(db, runId, 'score', counters);
  await withJob(db, leadId, runId, 'score_emails', 'dns', async () => (
    scoreLeadEmails(env, db, runId, leadId)
  ));

  await heartbeatRun(db, runId);
  await updateRunStage(db, runId, 'route', counters);
  const routedLead = await withJob(db, leadId, runId, 'select_route', 'internal', async () => (
    selectLeadRoute(db, runId, leadId)
  ));

  counters.leads_enriched += 1;
  if (routedLead?.status === 'ready') {
    counters.leads_ready += 1;
  } else if (routedLead?.status === 'review') {
    counters.leads_review += 1;
  }

  if (!routedLead || !['ready', 'review'].includes(routedLead.status)) {
    return;
  }

  await heartbeatRun(db, runId);
  await updateRunStage(db, runId, 'draft', counters);
  const draft = await withJob(db, leadId, runId, 'generate_draft', 'internal', async () => (
    generateLeadDraft(db, runId, leadId)
  ));

  if (draft) {
    counters.drafts_generated += 1;
  }
}

async function getQueuedLeadIds(db, excludedLeadIds = [], limit = 10) {
  const queued = await db.select('v2_leads', {
    columns: 'id',
    filters: [eq('status', 'new'), gte('relevance_score', 0.4)],
    ordering: [order('created_at', 'asc')],
    limit,
  });

  return queued
    .map((row) => row.id)
    .filter((leadId) => leadId && !excludedLeadIds.includes(leadId));
}

async function executeAutomationRun(env, db, run, config) {
  const counters = {
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

  const ingestResult = await withJob(db, null, run.id, 'ingest', 'nyc_dob', async () => (
    runIngestStage(env, db, run.id, config)
  ));

  Object.assign(counters, ingestResult.counters);

  const queuedLeadIds = await getQueuedLeadIds(
    db,
    ingestResult.leadsToEnrich,
    Math.max(ingestResult.leadsToEnrich.length, 10),
  );
  const leadIdsToProcess = [...ingestResult.leadsToEnrich, ...queuedLeadIds];

  for (const leadId of leadIdsToProcess) {
    await processLeadStages(env, db, run.id, leadId, counters);
  }

  await heartbeatRun(db, run.id);
  await updateRunStage(db, run.id, 'send', counters);
  const sendResult = await withJob(db, null, run.id, 'send', 'gmail', async () => (
    sendReadyLeads(env, db, run.id, config)
  ));

  counters.sends_attempted = sendResult.attempted;
  counters.sends_succeeded = sendResult.succeeded;
  counters.sends_failed = sendResult.failed;

  await heartbeatRun(db, run.id);
  await updateRunStage(db, run.id, 'follow_up', counters);
  await withJob(db, null, run.id, 'follow_up', 'gmail', async () => (
    processDueFollowUps(env, db)
  ));

  await completeRun(db, run.id, counters);

  return {
    run_id: run.id,
    status: 'completed',
    counts: {
      ...counters,
      ready: counters.leads_ready,
      review: counters.leads_review,
      enriched: counters.leads_enriched,
      drafted: counters.drafts_generated,
    },
  };
}

export async function startAutomationCycle(env, options = {}) {
  const db = createSupabaseClient(env);
  const config = await getAppConfig(db);
  const run = await createRun(
    db,
    options.triggerType || 'operator',
    options.triggeredBy || null,
    config,
    config.active_sources,
  );

  const task = executeAutomationRun(env, db, run, config).catch(async (error) => {
    await failRun(db, run.id, error);
    throw error;
  });

  return { run, task };
}

export async function runAutomationCycle(env, options = {}) {
  const { task } = await startAutomationCycle(env, options);
  return task;
}

export async function enrichLead(env, leadId, options = {}) {
  const db = createSupabaseClient(env);
  const config = await getAppConfig(db);
  const run = await createRun(
    db,
    options.triggerType || 'retry',
    options.triggeredBy || null,
    config,
    config.active_sources,
  );

  const counters = {
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

  try {
    await processLeadStages(env, db, run.id, leadId, counters);
    await completeRun(db, run.id, counters);
    return {
      run_id: run.id,
      lead_id: leadId,
      status: 'completed',
      counts: counters,
    };
  } catch (error) {
    await failRun(db, run.id, error);
    throw error;
  }
}

export async function getRunById(env, runId) {
  const db = createSupabaseClient(env);
  return db.single('v2_automation_runs', {
    filters: [eq('id', runId)],
  });
}

export async function getLatestRuns(env) {
  const db = createSupabaseClient(env);
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
