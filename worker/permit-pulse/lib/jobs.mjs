import { nowIso } from './utils.mjs';

function inferErrorCode(error) {
  const message = String(error instanceof Error ? error.message : error || '').toUpperCase();

  if (message.includes('GMAIL')) return 'GMAIL_ERROR';
  if (message.includes('FIRECRAWL')) return 'FIRECRAWL_ERROR';
  if (message.includes('DNS')) return 'DNS_ERROR';
  if (message.includes('SUPABASE')) return 'SUPABASE_ERROR';
  if (message.includes('BRAVE')) return 'BRAVE_ERROR';
  if (message.includes('MAPS')) return 'GOOGLE_MAPS_ERROR';

  return 'UNKNOWN_ERROR';
}

export async function withJob(db, leadId, runId, jobType, provider, fn, inputSnapshot = null) {
  const [job] = await db.insert('v2_lead_jobs', {
    lead_id: leadId,
    run_id: runId,
    job_type: jobType,
    provider,
    status: 'running',
    attempt_count: 1,
    input_snapshot: inputSnapshot,
    started_at: nowIso(),
  });

  try {
    const result = await fn(job);
    await db.update('v2_lead_jobs', [`id=eq.${job.id}`], {
      status: 'succeeded',
      output_snapshot: result,
      completed_at: nowIso(),
    });
    return result;
  } catch (error) {
    await db.update('v2_lead_jobs', [`id=eq.${job.id}`], {
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error || 'Job failed'),
      error_code: inferErrorCode(error),
      completed_at: nowIso(),
    });
    throw error;
  }
}
