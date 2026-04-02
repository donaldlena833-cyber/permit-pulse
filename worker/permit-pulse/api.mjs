import { getDefaultAttachmentStatus, hasGmailAutomation } from './lib/gmail.mjs';
import { createSupabaseClient, eq, inList, order } from './lib/supabase.mjs';
import { getAppConfig } from './lib/config.mjs';
import { countPendingAutomationLeads, summarizeRunQueue } from './lib/automation-queue.mjs';
import { getLatestRuns, getRunById, enrichLead, startAutomationCycle, startLeadBatchAutomation } from './pipeline/engine.mjs';
import { generateLeadDraft } from './pipeline/draft.mjs';
import { sendLead, sendReadyLeads } from './pipeline/send.mjs';
import { logPhoneFollowUp, sendFollowUp, skipFollowUp } from './pipeline/follow-up.mjs';
import {
  addManualLeadEmail,
  chooseLeadEmailCandidate,
  isLeadMarkedEmailRequired,
  markLeadEmailRequired,
  markLeadOutcome,
  switchLeadToFallback,
  vouchLeadEmail,
} from './pipeline/outcomes.mjs';

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: corsHeaders(),
  });
}

function getSupabaseApiKey(env) {
  return env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

async function authenticateRequest(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token || !env.SUPABASE_URL || !getSupabaseApiKey(env)) {
    return null;
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: getSupabaseApiKey(env),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

function parseBody(request) {
  return request.text().then((text) => {
    if (!text) {
      return {};
    }
    return JSON.parse(text);
  });
}

function tierOrder(tier) {
  if (tier === 'hot') return 0;
  if (tier === 'warm') return 1;
  return 2;
}

function parseLeadIds(body) {
  const values = body?.lead_ids || body?.leadIds || body?.ids || [];
  return Array.isArray(values)
    ? [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))].slice(0, 50)
    : [];
}

function isPublishedContact(candidate) {
  return candidate?.provenance_source !== 'pattern_guess';
}

function isSendApproved(candidate) {
  return Boolean(candidate?.is_auto_sendable || candidate?.is_manual_sendable);
}

function isBenignSystemFailure(job) {
  const message = String(job?.error_message || '');

  return message.includes('idx_v2_leads_permit_key')
    || message.includes('POST v2_lead_events failed: 502')
    || message.includes('POST v2_lead_events failed: 503')
    || message.includes('POST v2_lead_events failed: 504')
    || message.includes('v2_leads_status_check');
}

function presentLead(lead) {
  if (!lead) {
    return lead;
  }

  return {
    ...lead,
    status: lead.status === 'review' && isLeadMarkedEmailRequired(lead.operator_notes)
      ? 'email_required'
      : lead.status,
  };
}

function normalizeRunScope(run) {
  if (!run?.source_scope || typeof run.source_scope !== 'object' || Array.isArray(run.source_scope)) {
    return {
      mode: null,
      target_claim_count: 0,
      backlog_pending_at_start: 0,
      fresh_inserted: 0,
      progress: {},
    };
  }

  return run.source_scope;
}

async function presentRun(db, run) {
  if (!run) {
    return null;
  }

  const scope = normalizeRunScope(run);
  const [backlogPending, queueSummary] = await Promise.all([
    countPendingAutomationLeads(db),
    summarizeRunQueue(db, run.id, {
      claimedLeadIds: scope.claimed_lead_ids,
      processedLeadIds: scope.processed_lead_ids,
    }),
  ]);

  const targetClaimCount = Number(scope.target_claim_count || 0);
  const freshInserted = Number(scope.progress?.fresh_inserted || scope.fresh_inserted || 0);

  return {
    id: run.id,
    status: run.status,
    current_stage: run.current_stage,
    started_at: run.started_at,
    completed_at: run.completed_at || null,
    mode: scope.mode || null,
    target_claim_count: targetClaimCount,
    backlog_pending_at_start: Number(scope.backlog_pending_at_start || 0),
    counters: {
      permits_found: Number(run.permits_found || 0),
      permits_skipped_low_relevance: Number(run.permits_skipped_low_relevance || 0),
      permits_deduplicated: Number(run.permits_deduplicated || 0),
      leads_created: Number(run.leads_created || 0),
      leads_enriched: Number(run.leads_enriched || 0),
      leads_ready: Number(run.leads_ready || 0),
      leads_review: Number(run.leads_review || 0),
      drafts_generated: Number(run.drafts_generated || 0),
      sends_attempted: Number(run.sends_attempted || 0),
      sends_succeeded: Number(run.sends_succeeded || 0),
      sends_failed: Number(run.sends_failed || 0),
    },
    progress: {
      backlog_pending: backlogPending,
      claimed: queueSummary.claimed,
      processed: queueSummary.processed,
      fresh_inserted: freshInserted,
      remaining: Math.max(targetClaimCount - queueSummary.processed, 0),
      ready: queueSummary.ready,
      review: queueSummary.review,
      email_required: queueSummary.email_required,
      archived_no_email: queueSummary.archived,
      sent: queueSummary.sent,
    },
    summary: run.status === 'completed' || run.status === 'failed'
      ? {
          harvested: Number(run.permits_found || 0),
          deduplicated: Number(run.permits_deduplicated || 0),
          low_relevance: Number(run.permits_skipped_low_relevance || 0),
          created: Number(run.leads_created || 0),
          claimed: queueSummary.claimed,
          processed: queueSummary.processed,
          ready: Number(run.leads_ready || 0),
          review: Number(run.leads_review || 0),
          sent: Number(run.sends_succeeded || 0),
        }
      : undefined,
  };
}

async function getProcessedLeadsForRun(db, run) {
  if (!run) {
    return [];
  }

  const scope = normalizeRunScope(run);

  try {
    return await db.select('v2_leads', {
      filters: [eq('automation_claimed_by_run', run.id), eq('automation_state', 'processed')],
      ordering: [order('automation_processed_at', 'desc'), order('updated_at', 'desc')],
      limit: 20,
    });
  } catch (error) {
    const processedLeadIds = Array.isArray(scope.processed_lead_ids) ? scope.processed_lead_ids : [];
    if (processedLeadIds.length === 0) {
      return [];
    }
    return db.select('v2_leads', {
      filters: [inList('id', processedLeadIds)],
      ordering: [order('updated_at', 'desc')],
      limit: 20,
    });
  }
}

async function getTodayPayload(env) {
  const db = createSupabaseClient(env);
  const config = await getAppConfig(db);
  const { currentRun, lastRun } = await getLatestRuns(env);
  const displayRun = currentRun || lastRun || null;
  const [presentedCurrentRun, presentedLastRun, backlogPending, backlogLeads, readyLeads, reviewLeads, explicitEmailRequiredLeads, followUps, sentOutcomes, processedLeads] = await Promise.all([
    presentRun(db, currentRun),
    presentRun(db, lastRun),
    countPendingAutomationLeads(db),
    db.select('v2_leads', {
      filters: [eq('status', 'new'), eq('automation_state', 'pending')],
      ordering: [order('relevance_score', 'desc'), order('created_at', 'asc')],
      limit: 20,
    }),
    db.select('v2_leads', {
      filters: [eq('status', 'ready')],
      ordering: [order('updated_at', 'desc')],
      limit: 20,
    }),
    db.select('v2_leads', {
      filters: [eq('status', 'review')],
      ordering: [order('updated_at', 'desc')],
      limit: 40,
    }),
    db.select('v2_leads', {
      filters: [eq('status', 'email_required')],
      ordering: [order('updated_at', 'desc')],
      limit: 40,
    }),
    db.select('v2_follow_ups', {
      filters: [eq('status', 'pending')],
      ordering: [order('scheduled_at', 'asc')],
      limit: 20,
    }),
    db.select('v2_email_outcomes', {
      filters: [eq('outcome', 'sent')],
      ordering: [order('sent_at', 'desc')],
      limit: 5,
    }),
    getProcessedLeadsForRun(db, displayRun),
  ]);

  const leadIds = [...new Set([...followUps.map((row) => row.lead_id), ...sentOutcomes.map((row) => row.lead_id)])];
  const relatedLeads = leadIds.length > 0
    ? await db.select('v2_leads', { filters: [`id=in.(${leadIds.map((id) => `"${id}"`).join(',')})`] })
    : [];
  const leadMap = Object.fromEntries(relatedLeads.map((lead) => [lead.id, lead]));

  const sentToday = await db.select('v2_email_outcomes', {
    columns: 'id',
    filters: [eq('outcome', 'sent'), `sent_at=gte.${encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())}`],
  });

  const cap = config.warm_up_mode ? Number(config.warm_up_daily_cap || 5) : Number(config.daily_send_cap || 20);
  const legacyEmailRequiredLeads = reviewLeads.filter((lead) => isLeadMarkedEmailRequired(lead.operator_notes));
  const plainReviewLeads = reviewLeads.filter((lead) => !isLeadMarkedEmailRequired(lead.operator_notes));
  const emailRequiredLeads = [...explicitEmailRequiredLeads, ...legacyEmailRequiredLeads]
    .sort((left, right) => Number(new Date(right.updated_at || 0).getTime()) - Number(new Date(left.updated_at || 0).getTime()))
    .slice(0, 40);

  return {
    greeting: `Good ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date()) < 12 ? 'morning' : 'afternoon'}, Donald`,
    daily_cap: {
      sent: sentToday.length,
      cap,
      remaining: Math.max(cap - sentToday.length, 0),
    },
    warm_up: {
      enabled: Boolean(config.warm_up_mode),
      cap: Number(config.warm_up_daily_cap || 5),
    },
    current_run: presentedCurrentRun,
    last_run: presentedLastRun,
    automation_backlog_pending: backlogPending,
    counts: {
      new: backlogPending,
      ready: readyLeads.length,
      review: plainReviewLeads.length,
      email_required: emailRequiredLeads.length,
    },
    new_leads: backlogLeads.map(presentLead),
    automation_backlog: backlogLeads.map(presentLead),
    processed_this_run: processedLeads.map(presentLead),
    ready: readyLeads.map(presentLead),
    review: plainReviewLeads.map(presentLead),
    email_required: emailRequiredLeads.map(presentLead),
    follow_ups_due: followUps.map((item) => ({
      id: item.id,
      lead_id: item.lead_id,
      company_name: leadMap[item.lead_id]?.company_name || leadMap[item.lead_id]?.address || 'Lead',
      step: item.step_number,
      channel: item.channel,
      scheduled_at: item.scheduled_at,
      phone_script: item.phone_script || '',
    })),
    recent_sends: sentOutcomes.map((item) => ({
      lead_id: item.lead_id,
      company_name: leadMap[item.lead_id]?.company_name || leadMap[item.lead_id]?.address || 'Lead',
      email: item.email_address,
      sent_at: item.sent_at,
      outcome: item.outcome,
    })),
  };
}

async function getLeadDetail(env, leadId) {
  const db = createSupabaseClient(env);
  const [lead, companies, emails, followUps, timeline, relatedPermits] = await Promise.all([
    db.single('v2_leads', { filters: [eq('id', leadId)] }),
    db.select('v2_company_candidates', {
      filters: [eq('lead_id', leadId), eq('is_current', true)],
      ordering: [order('confidence', 'desc')],
      limit: 20,
    }),
    db.select('v2_email_candidates', {
      filters: [eq('lead_id', leadId), eq('is_current', true)],
      ordering: [order('trust_score', 'desc')],
      limit: 50,
    }),
    db.select('v2_follow_ups', {
      filters: [eq('lead_id', leadId)],
      ordering: [order('step_number', 'asc')],
    }),
    db.select('v2_lead_events', {
      filters: [eq('lead_id', leadId)],
      ordering: [order('created_at', 'desc')],
      limit: 50,
    }),
    db.select('v2_related_permits', {
      filters: [eq('lead_id', leadId)],
      ordering: [order('discovered_at', 'desc')],
      limit: 20,
    }),
  ]);

  if (!lead) {
    return null;
  }

  const discoveredEmails = emails.filter(isPublishedContact);
  const guessedEmails = emails.filter((candidate) => !isPublishedContact(candidate));
  const primary = emails.find((candidate) => candidate.is_primary) || null;
  const fallback = emails.find((candidate) => candidate.is_fallback) || null;
  const approvedPrimary = emails.find((candidate) => candidate.is_primary && isSendApproved(candidate))
    || emails.find(isSendApproved)
    || null;
  const approvedFallback = emails.find((candidate) => candidate.id !== approvedPrimary?.id && candidate.is_fallback && isSendApproved(candidate))
    || emails.find((candidate) => candidate.id !== approvedPrimary?.id && isSendApproved(candidate))
    || null;

  return {
    lead: presentLead(lead),
    contacts: {
      phone: lead.contact_phone || '',
      primary,
      fallback,
      approved_primary: approvedPrimary,
      approved_fallback: approvedFallback,
      discovered_emails: discoveredEmails,
      guessed_emails: guessedEmails,
    },
    candidates: {
      companies,
      emails,
    },
    draft: {
      subject: lead.draft_subject || '',
      body: lead.draft_body || '',
      cta_type: lead.draft_cta_type || '',
    },
    follow_ups: followUps,
    timeline,
    related_permits: relatedPermits,
  };
}

async function listLeads(env, requestUrl) {
  const db = createSupabaseClient(env);
  const page = Math.max(1, Number(requestUrl.searchParams.get('page') || 1));
  const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') || 20)));
  const status = requestUrl.searchParams.get('status');

  const filters = [];
  if (status === 'email_required') {
    filters.push(inList('status', ['review', 'email_required']));
  } else if (status === 'review') {
    filters.push(eq('status', 'review'));
  } else if (status && status !== 'all') {
    filters.push(eq('status', status));
  }

  const ordering = status === 'new'
    ? [order('relevance_score', 'desc'), order('created_at', 'asc')]
    : [order('updated_at', 'desc')];

  const leads = await db.select('v2_leads', {
    filters,
    ordering,
    limit: page * limit,
  });

  const presented = leads.map(presentLead);
  const filtered = status === 'review'
    ? presented.filter((lead) => lead.status === 'review')
    : status === 'email_required'
      ? presented.filter((lead) => lead.status === 'email_required')
      : status === 'new'
        ? presented.filter((lead) => lead.status === 'new')
        : presented;

  const sorted = [...filtered]
    .sort((left, right) => {
      const tierDelta = tierOrder(left.quality_tier) - tierOrder(right.quality_tier);
      if (tierDelta !== 0) return tierDelta;
      return Number(right.relevance_score || 0) - Number(left.relevance_score || 0);
    })
    .slice((page - 1) * limit, page * limit);

  return {
    leads: sorted,
    page,
    limit,
  };
}

export async function handlePermitPulseRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api')) {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return json({});
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    const attachment = await getDefaultAttachmentStatus(env);
    return json({
      ok: true,
      hasSupabase: Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)),
      hasGmail: hasGmailAutomation(env),
      hasBrave: Boolean(env.BRAVE_API_KEY),
      hasGoogleMaps: Boolean(env.GOOGLE_MAPS_API_KEY),
      hasFirecrawl: Boolean(env.FIRECRAWL_API_KEY),
      hasDefaultAttachment: attachment.loaded,
      defaultAttachmentName: attachment.filename || null,
    });
  }

  const user = await authenticateRequest(request, env);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const db = createSupabaseClient(env);

  try {
    if (url.pathname === '/api/today' && request.method === 'GET') {
      return json(await getTodayPayload(env));
    }

    if (url.pathname === '/api/scan' && request.method === 'POST') {
      const { run, task, activeRunReused } = await startAutomationCycle(env, {
        triggerType: 'operator',
        triggeredBy: user.email || null,
        mode: 'operator_scan',
        skipFollowUps: true,
      });

      if (task && ctx?.waitUntil) {
        ctx.waitUntil(task.catch((error) => {
          console.error('Automation run failed', error);
        }));
      } else if (task) {
        task.catch((error) => {
          console.error('Automation run failed', error);
        });
      }

      const scope = normalizeRunScope(run);

      return json({
        started: true,
        run_id: run.id,
        mode: 'operator_scan',
        target_claim_count: Number(scope.target_claim_count || 0),
        backlog_pending_at_start: Number(scope.backlog_pending_at_start || 0),
        active_run_reused: Boolean(activeRunReused),
      });
    }

    if ((url.pathname === '/api/leads/enrich-batch' || url.pathname === '/api/leads/automate-batch') && request.method === 'POST') {
      const body = await parseBody(request);
      const { run, accepted, task } = await startLeadBatchAutomation(env, parseLeadIds(body), {
        triggerType: 'operator',
        triggeredBy: user.email || null,
      });

      if (ctx?.waitUntil) {
        ctx.waitUntil(task.catch((error) => {
          console.error('Lead batch automation failed', error);
        }));
        return json({
          started: true,
          accepted,
          run_id: run.id,
        });
      }

      const result = await task.catch((error) => {
        console.error('Lead batch automation failed', error);
        throw error;
      });
      return json({
        started: true,
        accepted: result.accepted,
        run_id: run.id,
      });
    }

    if (url.pathname === '/api/leads/send-ready' && request.method === 'POST') {
      const config = await getAppConfig(db);
      return json(await sendReadyLeads(env, db, null, config));
    }

    if (url.pathname === '/api/leads' && request.method === 'GET') {
      return json(await listLeads(env, url));
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && request.method === 'GET') {
      const run = await getRunById(env, decodeURIComponent(runMatch[1]));
      return json(run ? await presentRun(db, run) : { error: 'Run not found' }, run ? 200 : 404);
    }

    const leadMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (leadMatch && request.method === 'GET') {
      const detail = await getLeadDetail(env, decodeURIComponent(leadMatch[1]));
      return json(detail || { error: 'Lead not found' }, detail ? 200 : 404);
    }

    const sendMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/send$/);
    if (sendMatch && request.method === 'POST') {
      return json(await sendLead(env, db, decodeURIComponent(sendMatch[1]), { actorId: user.email || null }));
    }

    const enrichMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/enrich$/);
    if (enrichMatch && request.method === 'POST') {
      return json(await enrichLead(env, decodeURIComponent(enrichMatch[1]), {
        triggerType: 'retry',
        triggeredBy: user.email || null,
      }));
    }

    const archiveMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/archive$/);
    if (archiveMatch && request.method === 'POST') {
      await db.update('v2_leads', [`id=eq.${decodeURIComponent(archiveMatch[1])}`], {
        status: 'archived',
        updated_at: new Date().toISOString(),
      });
      return json({ success: true });
    }

    const emailRequiredMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/email-required$/);
    if (emailRequiredMatch && request.method === 'POST') {
      return json(await markLeadEmailRequired(db, decodeURIComponent(emailRequiredMatch[1]), user.email || null));
    }

    const vouchMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/vouch$/);
    if (vouchMatch && request.method === 'POST') {
      return json(await vouchLeadEmail(db, decodeURIComponent(vouchMatch[1]), user.email || null));
    }

    const outcomeMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/outcome$/);
    if (outcomeMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await markLeadOutcome(db, decodeURIComponent(outcomeMatch[1]), body, user.email || null));
    }

    const switchFallbackMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/switch-fallback$/);
    if (switchFallbackMatch && request.method === 'POST') {
      return json(await switchLeadToFallback(db, decodeURIComponent(switchFallbackMatch[1]), user.email || null));
    }

    const chooseEmailMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/select-email$/);
    if (chooseEmailMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await chooseLeadEmailCandidate(
        db,
        decodeURIComponent(chooseEmailMatch[1]),
        body.candidate_id,
        user.email || null,
      ));
    }

    const manualEmailMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/manual-email$/);
    if (manualEmailMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await addManualLeadEmail(
        db,
        decodeURIComponent(manualEmailMatch[1]),
        body,
        user.email || null,
      ));
    }

    const draftRefreshMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/draft\/refresh$/);
    if (draftRefreshMatch && request.method === 'POST') {
      return json(await generateLeadDraft(db, null, decodeURIComponent(draftRefreshMatch[1])));
    }

    const draftMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/draft$/);
    if (draftMatch && request.method === 'PUT') {
      const body = await parseBody(request);
      const [lead] = await db.update('v2_leads', [`id=eq.${decodeURIComponent(draftMatch[1])}`], {
        draft_subject: body.subject || '',
        draft_body: body.body || '',
        draft_cta_type: body.cta_type || '',
        updated_at: new Date().toISOString(),
      });
      return json(lead || { success: true });
    }

    const followUpsMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups$/);
    if (followUpsMatch && request.method === 'GET') {
      const followUps = await db.select('v2_follow_ups', {
        filters: [eq('lead_id', decodeURIComponent(followUpsMatch[1]))],
        ordering: [order('step_number', 'asc')],
      });
      return json(followUps);
    }

    const followUpSendMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups\/([^/]+)\/send$/);
    if (followUpSendMatch && request.method === 'POST') {
      return json(await sendFollowUp(env, db, decodeURIComponent(followUpSendMatch[1]), Number(followUpSendMatch[2]), user.email || null));
    }

    const followUpSkipMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups\/([^/]+)\/skip$/);
    if (followUpSkipMatch && request.method === 'POST') {
      await skipFollowUp(db, decodeURIComponent(followUpSkipMatch[1]), Number(followUpSkipMatch[2]), user.email || null);
      return json({ success: true });
    }

    const followUpLogMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/follow-ups\/([^/]+)\/log$/);
    if (followUpLogMatch && request.method === 'POST') {
      const body = await parseBody(request);
      await logPhoneFollowUp(db, decodeURIComponent(followUpLogMatch[1]), Number(followUpLogMatch[2]), body.notes || '', user.email || null);
      return json({ success: true });
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json(await getAppConfig(db));
    }

    if (url.pathname === '/api/config' && request.method === 'PUT') {
      const body = await parseBody(request);
      const payload = Object.entries(body || {}).map(([key, value]) => ({ key, value }));
      if (payload.length > 0) {
        await db.upsert('v2_app_config', payload, 'key');
      }
      return json(await getAppConfig(db));
    }

    if (url.pathname === '/api/system' && request.method === 'GET') {
      const [recentFailureRows, totalLeads, domainHealth, runs] = await Promise.all([
        db.select('v2_lead_jobs', {
          filters: [eq('status', 'failed')],
          ordering: [order('created_at', 'desc')],
          limit: 25,
        }),
        db.select('v2_leads', { columns: 'id' }),
        db.select('v2_domain_health', { columns: 'domain,health_score,checked_at', limit: 20 }),
        db.select('v2_automation_runs', {
          ordering: [order('created_at', 'desc')],
          limit: 5,
        }),
      ]);
      const recentFailures = recentFailureRows
        .filter((failure) => !isBenignSystemFailure(failure))
        .slice(0, 5);

      return json({
        worker: {
          ok: true,
          has_gmail: hasGmailAutomation(env),
        },
        total_leads: totalLeads.length,
        recent_failures: recentFailures,
        domain_health: domainHealth,
        recent_runs: await Promise.all(runs.map((run) => presentRun(db, run))),
      });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
  }
}
