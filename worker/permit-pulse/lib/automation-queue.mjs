import { eq, inList, order } from './supabase.mjs';
import { nowIso } from './utils.mjs';

function isMissingAutomationQueueError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('automation_state')
    || message.includes('automation_claimed_by_run')
    || message.includes('automation_processed_at')
    || message.includes('42703');
}

async function selectLeadIds(db, filters = [], ordering = [], limit) {
  const rows = await db.select('v2_leads', {
    columns: 'id',
    filters,
    ordering,
    ...(limit !== undefined ? { limit } : {}),
  });

  return rows.map((row) => row.id).filter(Boolean);
}

export async function countPendingAutomationLeads(db) {
  try {
    const ids = await selectLeadIds(db, [eq('status', 'new'), eq('automation_state', 'pending')]);
    return ids.length;
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    const ids = await selectLeadIds(db, [eq('status', 'new')]);
    return ids.length;
  }
}

export async function listPendingAutomationLeads(db, limit = 20) {
  try {
    return await db.select('v2_leads', {
      filters: [eq('status', 'new'), eq('automation_state', 'pending')],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit,
    });
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    return db.select('v2_leads', {
      filters: [eq('status', 'new')],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit,
    });
  }
}

export async function claimPendingAutomationLeads(db, runId, limit = 0, options = {}) {
  const claimLimit = Math.max(0, Number(limit || 0));
  if (claimLimit <= 0) {
    return [];
  }

  const excludedLeadIds = [...new Set((options.excludeLeadIds || []).filter((value) => typeof value === 'string' && value.trim()))];

  try {
    const candidateIds = await selectLeadIds(
      db,
      [eq('status', 'new'), eq('automation_state', 'pending')],
      [order('relevance_score', 'desc'), order('created_at', 'asc')],
      claimLimit + excludedLeadIds.length,
    );

    const filteredCandidateIds = candidateIds.filter((id) => !excludedLeadIds.includes(id)).slice(0, claimLimit);
    if (filteredCandidateIds.length === 0) {
      return [];
    }

    const claimedAt = nowIso();
    await db.update('v2_leads', [inList('id', filteredCandidateIds), eq('automation_state', 'pending')], {
      automation_state: 'claimed',
      automation_claimed_by_run: runId,
      automation_claimed_at: claimedAt,
      updated_at: claimedAt,
    });

    const claimedRows = await db.select('v2_leads', {
      columns: 'id',
      filters: [eq('automation_claimed_by_run', runId), eq('automation_state', 'claimed')],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
    });

    return claimedRows
      .map((row) => row.id)
      .filter((id) => filteredCandidateIds.includes(id))
      .slice(0, claimLimit);
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }

    const fallbackRows = await db.select('v2_leads', {
      columns: 'id',
      filters: [eq('status', 'new')],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit: claimLimit + excludedLeadIds.length,
    });

    return fallbackRows
      .map((row) => row.id)
      .filter((id) => id && !excludedLeadIds.includes(id))
      .slice(0, claimLimit);
  }
}

export async function getClaimedLeadIdsForRun(db, runId, options = {}) {
  try {
    const filters = [eq('automation_claimed_by_run', runId)];
    if (options.onlyPending) {
      filters.push(eq('automation_state', 'claimed'));
    }
    if (options.onlyProcessed) {
      filters.push(eq('automation_state', 'processed'));
    }

    const ids = await selectLeadIds(
      db,
      filters,
      [order('relevance_score', 'desc'), order('created_at', 'asc')],
      options.limit,
    );

    return ids;
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    return [...new Set((options.fallbackIds || []).filter((value) => typeof value === 'string' && value.trim()))].slice(
      0,
      options.limit,
    );
  }
}

export async function markLeadAutomationProcessed(db, leadId, runId) {
  try {
    const processedAt = nowIso();
    const [lead] = await db.update('v2_leads', [`id=eq.${leadId}`], {
      automation_state: 'processed',
      automation_claimed_by_run: runId,
      automation_processed_at: processedAt,
      updated_at: processedAt,
    });

    return lead || null;
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    return db.single('v2_leads', {
      filters: [eq('id', leadId)],
    });
  }
}

export async function releaseAutomationLeadClaim(db, leadId) {
  try {
    const [lead] = await db.update('v2_leads', [`id=eq.${leadId}`, eq('status', 'new')], {
      automation_state: 'pending',
      automation_claimed_by_run: null,
      automation_claimed_at: null,
      updated_at: nowIso(),
    });

    return lead || null;
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    return null;
  }
}

export async function releaseClaimedLeadsForRuns(db, runIds = []) {
  const normalizedRunIds = [...new Set(runIds.filter((value) => typeof value === 'string' && value.trim()))];
  if (normalizedRunIds.length === 0) {
    return [];
  }

  try {
    return await db.update('v2_leads', [inList('automation_claimed_by_run', normalizedRunIds), eq('automation_state', 'claimed')], {
      automation_state: 'pending',
      automation_claimed_by_run: null,
      automation_claimed_at: null,
      updated_at: nowIso(),
    });
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }
    return [];
  }
}

export async function summarizeRunQueue(db, runId, options = {}) {
  const empty = {
    claimed: 0,
    processed: 0,
    ready: 0,
    review: 0,
    email_required: 0,
    archived: 0,
    sent: 0,
  };

  try {
    const leads = await db.select('v2_leads', {
      columns: 'id,status,automation_state',
      filters: [eq('automation_claimed_by_run', runId)],
    });

    const summary = {
      ...empty,
      claimed: leads.length,
    };

    for (const lead of leads) {
      if (lead.automation_state === 'processed') {
        summary.processed += 1;
      }

      if (lead.status === 'ready') {
        summary.ready += 1;
      } else if (lead.status === 'review') {
        summary.review += 1;
      } else if (lead.status === 'email_required') {
        summary.email_required += 1;
      } else if (lead.status === 'archived') {
        summary.archived += 1;
      } else if (lead.status === 'sent') {
        summary.sent += 1;
      }
    }

    return summary;
  } catch (error) {
    if (!isMissingAutomationQueueError(error)) {
      throw error;
    }

    const claimedLeadIds = [...new Set((options.claimedLeadIds || []).filter((value) => typeof value === 'string' && value.trim()))];
    const processedLeadIds = new Set((options.processedLeadIds || []).filter((value) => typeof value === 'string' && value.trim()));
    if (claimedLeadIds.length === 0) {
      return empty;
    }

    const leads = await db.select('v2_leads', {
      columns: 'id,status',
      filters: [inList('id', claimedLeadIds)],
    });

    const summary = {
      ...empty,
      claimed: claimedLeadIds.length,
      processed: processedLeadIds.size,
    };

    for (const lead of leads) {
      if (lead.status === 'ready') {
        summary.ready += 1;
      } else if (lead.status === 'review') {
        summary.review += 1;
      } else if (lead.status === 'email_required') {
        summary.email_required += 1;
      } else if (lead.status === 'archived') {
        summary.archived += 1;
      } else if (lead.status === 'sent') {
        summary.sent += 1;
      }
    }

    return summary;
  }
}
