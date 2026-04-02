import { nowIso } from './utils.mjs';

export async function createRun(db, triggerType, triggeredBy, config, sourceScope = ['nyc_dob']) {
  const [run] = await db.insert('v2_automation_runs', {
    trigger_type: triggerType,
    triggered_by: triggeredBy || null,
    status: 'running',
    current_stage: 'scan',
    config_snapshot: config,
    source_scope: sourceScope,
    started_at: nowIso(),
    heartbeat_at: nowIso(),
  });

  return run;
}

export async function updateRun(db, runId, patch) {
  const [run] = await db.update('v2_automation_runs', [`id=eq.${runId}`], {
    ...patch,
    heartbeat_at: nowIso(),
  });

  return run || null;
}

export async function updateRunStage(db, runId, stage, counters = {}, extraPatch = {}) {
  return updateRun(db, runId, {
    current_stage: stage,
    ...counters,
    ...extraPatch,
  });
}

export async function heartbeatRun(db, runId) {
  return updateRun(db, runId, {});
}

export async function completeRun(db, runId, counters = {}, extraPatch = {}) {
  return updateRun(db, runId, {
    status: 'completed',
    current_stage: null,
    completed_at: nowIso(),
    ...counters,
    ...extraPatch,
  });
}

export async function failRun(db, runId, error, counters = {}, extraPatch = {}) {
  return updateRun(db, runId, {
    status: 'failed',
    last_error: error instanceof Error ? error.message : String(error || 'Run failed'),
    error_count: (counters.error_count || 0) + 1,
    completed_at: nowIso(),
    ...counters,
    ...extraPatch,
  });
}

export async function getRunningRun(db) {
  return db.single('v2_automation_runs', {
    filters: ['status=eq.running'],
    ordering: ['order=created_at.desc.nullslast'],
  });
}

export async function expireStaleRuns(db, options = {}) {
  const staleAfterMinutes = Math.max(5, Number(options.staleAfterMinutes || 20));
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

  return db.update(
    'v2_automation_runs',
    ['status=eq.running', `heartbeat_at=lt.${encodeURIComponent(cutoff)}`],
    {
      status: 'failed',
      current_stage: null,
      last_error: 'Run timed out waiting for progress',
      completed_at: nowIso(),
      heartbeat_at: nowIso(),
    },
  );
}
