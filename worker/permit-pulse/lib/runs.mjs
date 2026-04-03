import { nowIso } from './utils.mjs';
import { order } from './supabase.mjs';

export async function createRun(db, triggerType, triggeredBy, config, sourceScope = ['nyc_dob'], options = {}) {
  const initialStage = options.initialStage || 'scan';
  const [run] = await db.insert('v2_automation_runs', {
    trigger_type: triggerType,
    triggered_by: triggeredBy || null,
    status: 'running',
    current_stage: initialStage,
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

export async function getRunningRun(db, options = {}) {
  const rows = await db.select('v2_automation_runs', {
    filters: ['status=eq.running'],
    ordering: ['order=created_at.desc.nullslast'],
    limit: 10,
  });

  const excludeProspect = options.excludeProspect !== false;
  if (!excludeProspect) {
    return rows[0] || null;
  }

  return rows.find((run) => {
    const scope = run?.source_scope && typeof run.source_scope === 'object' && !Array.isArray(run.source_scope)
      ? run.source_scope
      : {};
    return !String(scope.mode || '').startsWith('prospect_');
  }) || null;
}

export async function listRecentRuns(db, limit = 25) {
  return db.select('v2_automation_runs', {
    ordering: [order('created_at', 'desc')],
    limit,
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
