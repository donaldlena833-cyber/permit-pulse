import { getAttachmentStatus, hasGmailAutomation } from './lib/gmail.mjs';
import { isApprovedRouteCandidate, isPublishedEmailCandidate, isOfficialSitePublishedContact, withApprovedTrustFloor } from './lib/email-approval.mjs';
import {
  getProspectAutomationOverview,
  getProspectDetail,
  importProspects,
  listProspects,
  markProspectBounced,
  markProspectReply,
  optOutProspect,
  removeProspectSuppression,
  resolveOutreachReviewItem,
  saveProspectDraft,
  saveProspectNotes,
  sendProspect,
  suppressProspectScope,
  updateProspectStatus,
  runScheduledProspectPilot,
} from './lib/prospects.mjs';
import { createSupabaseClient, eq, inList, order } from './lib/supabase.mjs';
import {
  acceptWorkspaceInvite,
  archiveWorkspaceAttachment,
  beginGmailMailboxConnect,
  bootstrapWorkspaceOwner,
  createWorkspaceInvite,
  disableWorkspaceMember,
  getOnboardingState,
  getWorkspaceInvite,
  listWorkspaceAttachments,
  listWorkspaceMailboxes,
  resendWorkspaceInvite,
  resolveTenantContext,
  setWorkspaceAttachmentDefault,
  transferWorkspaceOwnership,
  updateOnboardingProfile,
  updateWorkspaceAccount,
  updateWorkspaceMemberRole,
  uploadWorkspaceAttachment,
} from './lib/account.mjs';
import { listAuditEvents } from './lib/audit.mjs';
import { createBillingCheckoutSession, createBillingPortalSession, handleBillingWebhook } from './lib/billing.mjs';
import { getAppConfig, saveAppConfig } from './lib/config.mjs';
import { countPendingAutomationLeads, listPendingAutomationLeads, summarizeRunQueue } from './lib/automation-queue.mjs';
import { getLatestRuns, getRunById, enrichLead, startAutomationCycle, startLeadBatchAutomation } from './pipeline/engine.mjs';
import { generateLeadDraft } from './pipeline/draft.mjs';
import { sendLead, sendReadyLeads } from './pipeline/send.mjs';
import { backfillPermitFollowUps, logPhoneFollowUp, processDueFollowUps, sendFollowUp, skipFollowUp } from './pipeline/follow-up.mjs';
import {
  addManualLeadEmail,
  chooseLeadEmailCandidate,
  isLeadMarkedEmailRequired,
  markLeadEmailRequired,
  markLeadOutcome,
  switchLeadToFallback,
  vouchLeadEmail,
} from './pipeline/outcomes.mjs';
import { readReplySyncState, syncOutreachReplies } from './lib/reply-sync.mjs';
import { completeRun, createRun, failRun } from './lib/runs.mjs';
import { createTenantScopedDb, resolveSharedProspectTenantId } from './lib/tenant-db.mjs';

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

function minutesAgo(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(Math.round((Date.now() - value) / (1000 * 60)), 0);
}

function freshnessStatus(timestamp, thresholds = { healthy: 90, warning: 360 }) {
  const ageMinutes = minutesAgo(timestamp);
  if (ageMinutes === null) {
    return {
      status: 'missing',
      age_minutes: null,
    };
  }

  if (ageMinutes <= thresholds.healthy) {
    return {
      status: 'healthy',
      age_minutes: ageMinutes,
    };
  }

  if (ageMinutes <= thresholds.warning) {
    return {
      status: 'warning',
      age_minutes: ageMinutes,
    };
  }

  return {
    status: 'stale',
    age_minutes: ageMinutes,
  };
}

async function buildWorkspaceMetrics(db) {
  const [leadOutcomes, prospectOutcomes, runs] = await Promise.all([
    db.select('v2_email_outcomes', {
      columns: 'outcome,sent_at,created_at',
      ordering: [order('created_at', 'desc')],
      limit: 500,
    }).catch(() => []),
    db.select('v2_prospect_outcomes', {
      columns: 'outcome,sent_at,created_at',
      ordering: [order('created_at', 'desc')],
      limit: 500,
    }).catch(() => []),
    db.select('v2_automation_runs', {
      columns: 'status,created_at,sends_succeeded,sends_failed',
      ordering: [order('created_at', 'desc')],
      limit: 120,
    }).catch(() => []),
  ]);

  const last30Days = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  const recentLeadOutcomes = leadOutcomes.filter((row) => new Date(row.sent_at || row.created_at || 0) >= last30Days);
  const recentProspectOutcomes = prospectOutcomes.filter((row) => new Date(row.sent_at || row.created_at || 0) >= last30Days);
  const recentRuns = runs.filter((row) => new Date(row.created_at || 0) >= last30Days);

  return {
    lead_sends_30d: recentLeadOutcomes.filter((row) => row.outcome === 'sent').length,
    prospect_sends_30d: recentProspectOutcomes.filter((row) => row.outcome === 'sent').length,
    prospect_positive_replies_30d: recentProspectOutcomes.filter((row) => row.outcome === 'positive_reply').length,
    prospect_opt_outs_30d: recentProspectOutcomes.filter((row) => row.outcome === 'opt_out').length,
    runs_30d: recentRuns.length,
    runs_failed_30d: recentRuns.filter((row) => row.status === 'failed').length,
  };
}

function resolveRedirectBase(env, requestUrl) {
  const configured = String(env?.PERMIT_PULSE_APP_URL || env?.PUBLIC_APP_URL || env?.APP_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  try {
    return new URL(requestUrl).origin;
  } catch {
    return '';
  }
}

async function buildSystemPayload(env, db, tenantContext) {
  const [attachment, recentFailureRows, totalLeads, totalProspects, domainHealth, runs, replySync, config, metrics] = await Promise.all([
    getAttachmentStatus(env, {
      attachmentKey: tenantContext.tenant?.default_attachment?.storage_key || undefined,
      attachmentFilename: tenantContext.tenant?.default_attachment?.filename || undefined,
      attachmentContentType: tenantContext.tenant?.default_attachment?.content_type || undefined,
    }),
    db.select('v2_lead_jobs', {
      filters: [eq('status', 'failed')],
      ordering: [order('created_at', 'desc')],
      limit: 25,
    }),
    db.select('v2_leads', { columns: 'id' }),
    db.select('v2_prospects', { columns: 'id' }).catch(() => []),
    db.select('v2_domain_health', { columns: 'domain,health_score,checked_at', limit: 20 }).catch(() => []),
    db.select('v2_automation_runs', {
      ordering: [order('created_at', 'desc')],
      limit: 5,
    }),
    readReplySyncState(env, { scopeKey: tenantContext.reply_sync_scope_key || tenantContext.tenant.id }),
    getAppConfig(db),
    buildWorkspaceMetrics(db),
  ]);

  const recentFailures = recentFailureRows
    .filter((failure) => !isBenignSystemFailure(failure))
    .slice(0, 5);
  const latestRun = runs[0] || null;
  const workspaceHealth = {
    mailbox_connected: Boolean(tenantContext.tenant?.default_mailbox?.email),
    mailbox_email: tenantContext.tenant?.default_mailbox?.email || null,
    attachment_loaded: Boolean(attachment.loaded),
    attachment_filename: attachment.filename || null,
    billing_status: tenantContext.tenant.subscription_status,
    run_freshness: freshnessStatus(latestRun?.created_at || latestRun?.started_at || null, {
      healthy: 180,
      warning: 720,
    }),
    reply_sync_freshness: freshnessStatus(replySync?.checked_at || null, {
      healthy: 180,
      warning: 720,
    }),
    outbound_safety: {
      permit_auto_send_enabled: Boolean(config.permit_auto_send_enabled),
      daily_send_cap: Number(config.daily_send_cap || 0),
      auto_send_trust_threshold: Number(config.auto_send_trust_threshold || 0),
      follow_up_enabled: Boolean(config.follow_up_enabled),
    },
  };

  return {
    account: tenantContext.presentedTenant,
    current_member: tenantContext.presentedMember,
    members: tenantContext.members,
    onboarding: tenantContext.onboarding,
    attachments: tenantContext.attachments,
    default_attachment: tenantContext.tenant?.default_attachment || null,
    mailboxes: tenantContext.mailboxes,
    default_mailbox: tenantContext.tenant?.default_mailbox || null,
    billing: {
      status: tenantContext.tenant.subscription_status,
      stripe_customer_id: tenantContext.tenant.stripe_customer_id || null,
      stripe_subscription_id: tenantContext.tenant.stripe_subscription_id || null,
      owner_only: true,
    },
    worker: {
      ok: workspaceHealth.mailbox_connected && attachment.loaded,
      has_gmail_client: hasGmailAutomation(env),
    },
    health: workspaceHealth,
    metrics,
    total_leads: totalLeads.length,
    total_prospects: totalProspects.length,
    recent_failures: recentFailures,
    domain_health_reference: domainHealth,
    recent_runs: await Promise.all(runs.map((run) => presentRun(db, run))),
    reply_sync: replySync,
  };
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
  return isPublishedEmailCandidate(candidate);
}

function isSendApproved(candidate, lead = null) {
  return isApprovedRouteCandidate(candidate, lead);
}

function presentEmailCandidate(candidate, lead = null) {
  if (!candidate) {
    return candidate;
  }

  if (!isOfficialSitePublishedContact(candidate, lead)) {
    return candidate;
  }

  const approved = withApprovedTrustFloor(candidate, lead, candidate.trust_score, candidate.trust_reasons || []);
  return {
    ...candidate,
    trust_score: approved.trust,
    trust_reasons: approved.reasons,
    is_manual_sendable: true,
    is_auto_sendable: Boolean(candidate.is_auto_sendable || approved.trust >= 38),
    is_research_only: false,
  };
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
    slot_key: scope.slot_key || null,
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
    per_category: scope.per_category || null,
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

async function getTodayPayload(env, db, tenantContext) {
  const config = await getAppConfig(db);
  const { currentRun, lastRun } = await getLatestRuns(env, { db });
  const displayRun = currentRun || lastRun || null;
  const [
    presentedCurrentRun,
    presentedLastRun,
    backlogPending,
    backlogLeads,
    readyLeads,
    reviewLeads,
    explicitEmailRequiredLeads,
    followUps,
    sentOutcomes,
    processedLeads,
    prospectAutomation,
    replySync,
  ] = await Promise.all([
    presentRun(db, currentRun),
    presentRun(db, lastRun),
    countPendingAutomationLeads(db),
    listPendingAutomationLeads(db, 20),
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
    getProspectAutomationOverview(db, config),
    readReplySyncState(env, {
      scopeKey: tenantContext?.sharedProspectTenantId || tenantContext?.tenant?.id || 'global',
    }),
  ]);

  const leadIds = [...new Set([...followUps.map((row) => row.lead_id), ...sentOutcomes.map((row) => row.lead_id)])];
  const relatedLeads = leadIds.length > 0
    ? await db.select('v2_leads', { filters: [`id=in.(${leadIds.map((id) => `"${id}"`).join(',')})`] })
    : [];
  const leadMap = Object.fromEntries(relatedLeads.map((lead) => [lead.id, lead]));

  const sentSince = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const [leadSentToday, prospectSentToday] = await Promise.all([
    db.select('v2_email_outcomes', {
      columns: 'id',
      filters: [eq('outcome', 'sent'), `sent_at=gte.${encodeURIComponent(sentSince)}`],
    }),
    db.select('v2_prospect_outcomes', {
      columns: 'id',
      filters: [eq('outcome', 'sent'), `sent_at=gte.${encodeURIComponent(sentSince)}`],
    }).catch(() => []),
  ]);

  const sentToday = [...leadSentToday, ...prospectSentToday];

  const cap = config.warm_up_mode ? Number(config.warm_up_daily_cap || 5) : Number(config.daily_send_cap || 20);
  const legacyEmailRequiredLeads = reviewLeads.filter((lead) => isLeadMarkedEmailRequired(lead.operator_notes));
  const plainReviewLeads = reviewLeads.filter((lead) => !isLeadMarkedEmailRequired(lead.operator_notes));
  const emailRequiredLeads = [...explicitEmailRequiredLeads, ...legacyEmailRequiredLeads]
    .sort((left, right) => Number(new Date(right.updated_at || 0).getTime()) - Number(new Date(left.updated_at || 0).getTime()))
    .slice(0, 40);

  return {
    greeting: `Good ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: config.prospect_timezone || 'America/New_York' }).format(new Date()) < 12 ? 'morning' : 'afternoon'}, ${tenantContext?.tenant?.sender_name || 'there'}`,
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
    prospect_automation: {
      ...prospectAutomation,
      reply_sync: replySync,
    },
  };
}

async function getLeadDetail(db, leadId) {
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

  const presentedEmails = emails.map((candidate) => presentEmailCandidate(candidate, lead));
  const discoveredEmails = presentedEmails.filter(isPublishedContact);
  const guessedEmails = presentedEmails.filter((candidate) => !isPublishedContact(candidate));
  const primary = presentedEmails.find((candidate) => candidate.is_primary) || null;
  const fallback = presentedEmails.find((candidate) => candidate.is_fallback) || null;
  const approvedPrimary = presentedEmails.find((candidate) => candidate.is_primary && isSendApproved(candidate, lead))
    || presentedEmails.find((candidate) => isSendApproved(candidate, lead))
    || null;
  const approvedFallback = presentedEmails.find((candidate) => candidate.id !== approvedPrimary?.id && candidate.is_fallback && isSendApproved(candidate, lead))
    || presentedEmails.find((candidate) => candidate.id !== approvedPrimary?.id && isSendApproved(candidate, lead))
    || null;

  return {
    lead: presentLead({
      ...lead,
      contact_email_trust: primary?.email_address === lead.contact_email
        ? Number(primary?.trust_score || lead.contact_email_trust || 0)
        : Number(lead.contact_email_trust || 0),
      fallback_email_trust: fallback?.email_address === lead.fallback_email
        ? Number(fallback?.trust_score || lead.fallback_email_trust || 0)
        : Number(lead.fallback_email_trust || 0),
    }),
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
      emails: presentedEmails,
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

async function listLeads(db, requestUrl) {
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
    const attachment = await getAttachmentStatus(env);
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

  const rawDb = createSupabaseClient(env);

  if (url.pathname === '/api/billing/webhook' && request.method === 'POST') {
    try {
      return json(await handleBillingWebhook(request, env, rawDb));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Webhook failed' }, 400);
    }
  }

  const inviteMatch = url.pathname.match(/^\/api\/account\/invites\/([^/]+)$/);
  if (inviteMatch && request.method === 'GET') {
    try {
      return json(await getWorkspaceInvite(rawDb, decodeURIComponent(inviteMatch[1])));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invite not found' }, 404);
    }
  }

  if (url.pathname === '/api/account/mailboxes/gmail/callback' && request.method === 'GET') {
    try {
      const result = await completeGmailMailboxConnect(env, rawDb, {
        state: url.searchParams.get('state'),
        code: url.searchParams.get('code'),
        error: url.searchParams.get('error'),
      });
      const destination = `${resolveRedirectBase(env, request.url)}${result.redirect_path || '/app/settings'}?gmail=connected`;
      return Response.redirect(destination, 302);
    } catch (error) {
      const destination = `${resolveRedirectBase(env, request.url)}/app/settings?gmail=error&message=${encodeURIComponent(error instanceof Error ? error.message : 'Gmail connect failed')}`;
      return Response.redirect(destination, 302);
    }
  }

  const user = await authenticateRequest(request, env);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (url.pathname === '/api/onboarding' && request.method === 'GET') {
    return json(await getOnboardingState(rawDb, user));
  }

  if (url.pathname === '/api/onboarding/bootstrap' && request.method === 'POST') {
    const body = await parseBody(request);
    const tenantContext = await bootstrapWorkspaceOwner(rawDb, user, body);
    return json({
      account: tenantContext.presentedTenant,
      current_member: tenantContext.presentedMember,
      onboarding: tenantContext.onboarding,
      attachments: tenantContext.attachments,
      mailboxes: tenantContext.mailboxes,
    }, 201);
  }

  if (inviteMatch && request.method === 'POST') {
    return json(await acceptWorkspaceInvite(rawDb, user, decodeURIComponent(inviteMatch[1])));
  }

  const tenantContext = await resolveTenantContext(rawDb, user);

  if (!tenantContext) {
    return json({ error: 'No workspace access configured for this user' }, 403);
  }

  const sharedProspectTenantId = await resolveSharedProspectTenantId(rawDb, tenantContext.tenant.id);
  tenantContext.sharedProspectTenantId = sharedProspectTenantId;
  const replySyncScopeKey = sharedProspectTenantId || tenantContext.tenant.id;
  const db = createTenantScopedDb(rawDb, tenantContext.tenant.id, {
    sharedProspectTenantId,
  });

  try {
    if (url.pathname === '/api/today' && request.method === 'GET') {
      return json(await getTodayPayload(env, db, tenantContext));
    }

    if (url.pathname === '/api/scan' && request.method === 'POST') {
      const { run, task, activeRunReused } = await startAutomationCycle(env, {
        db,
        triggerType: 'operator',
        triggeredBy: user.email || null,
        mode: 'operator_scan',
        skipFollowUps: true,
        workspace: tenantContext.tenant,
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
        db,
        triggerType: 'operator',
        triggeredBy: user.email || null,
        workspace: tenantContext.tenant,
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
      return json(await sendReadyLeads(env, db, null, config, {
        ignoreDailyCap: true,
        workspace: tenantContext.tenant,
      }));
    }

    if (url.pathname === '/api/leads' && request.method === 'GET') {
      return json(await listLeads(db, url));
    }

    if (url.pathname === '/api/prospects' && request.method === 'GET') {
      const [payload, replySync] = await Promise.all([
        listProspects(db, {
          status: url.searchParams.get('status') || 'all',
          category: url.searchParams.get('category') || 'all',
          q: url.searchParams.get('q') || '',
          page: Number(url.searchParams.get('page') || 1),
          limit: Number(url.searchParams.get('limit') || 20),
        }),
        readReplySyncState(env, { scopeKey: replySyncScopeKey }),
      ]);
      return json({
        ...payload,
        automation: {
          ...payload.automation,
          reply_sync: replySync,
        },
      });
    }

    if (url.pathname === '/api/prospects/import' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await importProspects(db, body, user.email || null));
    }

    if (url.pathname === '/api/outreach/sync-replies' && request.method === 'POST') {
      return json(await syncOutreachReplies(env, db, {
        maxResults: 60,
        newerThanDays: 21,
        queueUnmatched: false,
        scopeKey: replySyncScopeKey,
        mailbox: tenantContext.tenant.default_mailbox || null,
      }));
    }

    if (url.pathname === '/api/prospects/run-daily-send' && request.method === 'POST') {
      return json(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
        ignoreDailyCap: true,
        mode: 'prospect_manual_send',
        slotKey: null,
        workspace: tenantContext.tenant,
      }));
    }

    const reviewResolveMatch = url.pathname.match(/^\/api\/outreach\/review\/([^/]+)\/resolve$/);
    if (reviewResolveMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await resolveOutreachReviewItem(db, decodeURIComponent(reviewResolveMatch[1]), body, user.email || null));
    }

    const suppressionRemoveMatch = url.pathname.match(/^\/api\/outreach\/suppressions\/([^/]+)\/remove$/);
    if (suppressionRemoveMatch && request.method === 'POST') {
      return json(await removeProspectSuppression(db, decodeURIComponent(suppressionRemoveMatch[1]), user.email || null));
    }

    if (url.pathname === '/api/leads/follow-ups/send-due' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await processDueFollowUps(env, db, {
        limit: Number(body?.limit || 20),
        workspace: tenantContext.tenant,
      }));
    }

    if (url.pathname === '/api/leads/follow-ups/repair' && request.method === 'POST') {
      const body = await parseBody(request);
      const config = await getAppConfig(db);
      return json(await backfillPermitFollowUps(db, config, {
        limit: Number(body?.limit || 500),
        lookbackDays: Number(body?.lookback_days || 60),
      }));
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && request.method === 'GET') {
      const run = await getRunById(env, decodeURIComponent(runMatch[1]), { db });
      return json(run ? await presentRun(db, run) : { error: 'Run not found' }, run ? 200 : 404);
    }

    const prospectMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)$/);
    if (prospectMatch && request.method === 'GET') {
      const detail = await getProspectDetail(db, decodeURIComponent(prospectMatch[1]));
      return json(detail || { error: 'Prospect not found' }, detail ? 200 : 404);
    }

    const prospectSendMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/send$/);
    if (prospectSendMatch && request.method === 'POST') {
      return json(await sendProspect(env, db, decodeURIComponent(prospectSendMatch[1]), user.email || null, tenantContext.tenant));
    }

    const prospectReplyMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/reply$/);
    if (prospectReplyMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await markProspectReply(db, decodeURIComponent(prospectReplyMatch[1]), user.email || null, body?.tone || 'neutral'));
    }

    const prospectBounceMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/bounce$/);
    if (prospectBounceMatch && request.method === 'POST') {
      return json(await markProspectBounced(db, decodeURIComponent(prospectBounceMatch[1]), user.email || null));
    }

    const prospectOptOutMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/opt-out$/);
    if (prospectOptOutMatch && request.method === 'POST') {
      return json(await optOutProspect(db, decodeURIComponent(prospectOptOutMatch[1]), user.email || null));
    }

    const prospectSuppressMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/suppress$/);
    if (prospectSuppressMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await suppressProspectScope(
        db,
        decodeURIComponent(prospectSuppressMatch[1]),
        body?.scope_type || 'email',
        user.email || null,
        body?.reason || 'manual_suppression',
      ));
    }

    const prospectDraftMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/draft$/);
    if (prospectDraftMatch && request.method === 'PUT') {
      const body = await parseBody(request);
      return json(await saveProspectDraft(db, decodeURIComponent(prospectDraftMatch[1]), body, user.email || null));
    }

    const prospectNotesMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/notes$/);
    if (prospectNotesMatch && request.method === 'PUT') {
      const body = await parseBody(request);
      return json(await saveProspectNotes(db, decodeURIComponent(prospectNotesMatch[1]), body?.notes || '', user.email || null));
    }

    const prospectStatusMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/status$/);
    if (prospectStatusMatch && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await updateProspectStatus(db, decodeURIComponent(prospectStatusMatch[1]), body?.status, user.email || null));
    }

    const leadMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (leadMatch && request.method === 'GET') {
      const detail = await getLeadDetail(db, decodeURIComponent(leadMatch[1]));
      return json(detail || { error: 'Lead not found' }, detail ? 200 : 404);
    }

    const sendMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/send$/);
    if (sendMatch && request.method === 'POST') {
      const config = await getAppConfig(db);
      return json(await sendLead(env, db, decodeURIComponent(sendMatch[1]), {
        actorId: user.email || null,
        followUpSequence: config.follow_up_sequence,
        workspace: tenantContext.tenant,
      }));
    }

    const enrichMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/enrich$/);
    if (enrichMatch && request.method === 'POST') {
      return json(await enrichLead(env, decodeURIComponent(enrichMatch[1]), {
        db,
        triggerType: 'retry',
        triggeredBy: user.email || null,
        workspace: tenantContext.tenant,
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
      return json(await generateLeadDraft(db, null, decodeURIComponent(draftRefreshMatch[1]), tenantContext.tenant));
    }

    const draftMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/draft$/);
    if (draftMatch && request.method === 'PUT') {
      const body = await parseBody(request);
      const [lead] = await db.update('v2_leads', [`id=eq.${decodeURIComponent(draftMatch[1])}`], {
        draft_subject: typeof body.subject === 'string' ? body.subject.trim() : '',
        draft_body: typeof body.body === 'string' ? body.body.trim() : '',
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
      return json(await sendFollowUp(
        env,
        db,
        decodeURIComponent(followUpSendMatch[1]),
        Number(followUpSendMatch[2]),
        user.email || null,
        tenantContext.tenant,
      ));
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
      const previousConfig = await getAppConfig(db);
      const nextConfig = await saveAppConfig(db, body);
      const trackedKeys = ['permit_auto_send_enabled', 'daily_send_cap', 'auto_send_trust_threshold', 'manual_send_trust_threshold', 'follow_up_enabled'];
      const changed = trackedKeys
        .filter((key) => JSON.stringify(previousConfig?.[key]) !== JSON.stringify(nextConfig?.[key]))
        .reduce((result, key) => {
          result[key] = {
            before: previousConfig?.[key],
            after: nextConfig?.[key],
          };
          return result;
        }, {});

      if (Object.keys(changed).length > 0) {
        await appendAuditEvent(db, {
          actorType: 'user',
          actorId: user.email || null,
          eventType: 'outbound_safety_settings_updated',
          targetType: 'tenant_config',
          targetId: tenantContext.tenant.id,
          detail: changed,
        });
      }

      return json(nextConfig);
    }

    if (url.pathname === '/api/onboarding/profile' && request.method === 'PUT') {
      const body = await parseBody(request);
      return json(await updateOnboardingProfile(rawDb, tenantContext, body, user.email || null));
    }

    if (url.pathname === '/api/system' && request.method === 'GET') {
      return json(await buildSystemPayload(env, db, {
        ...tenantContext,
        reply_sync_scope_key: replySyncScopeKey,
        tenant: {
          ...tenantContext.tenant,
          onboarding: tenantContext.onboarding,
          attachments: tenantContext.attachments,
          mailboxes: tenantContext.mailboxes,
        },
      }));
    }

    if (url.pathname === '/api/system/audit' && request.method === 'GET') {
      return json(await listAuditEvents(db, {
        page: Number(url.searchParams.get('page') || 1),
        limit: Number(url.searchParams.get('limit') || 20),
        eventType: url.searchParams.get('event_type') || '',
      }));
    }

    if (url.pathname === '/api/system/metrics' && request.method === 'GET') {
      return json(await buildWorkspaceMetrics(db));
    }

    if (url.pathname === '/api/account' && request.method === 'PUT') {
      const body = await parseBody(request);
      return json(await updateWorkspaceAccount(rawDb, tenantContext, body, user.email || null));
    }

    if (url.pathname === '/api/account/attachments' && request.method === 'GET') {
      return json(await listWorkspaceAttachments(rawDb, tenantContext));
    }

    if (url.pathname === '/api/account/attachments' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await uploadWorkspaceAttachment(env, rawDb, tenantContext, body, user.email || null), 201);
    }

    if (url.pathname === '/api/account/attachment' && request.method === 'PUT') {
      const body = await parseBody(request);
      return json(await uploadWorkspaceAttachment(env, rawDb, tenantContext, body, user.email || null), 201);
    }

    const attachmentDefaultMatch = url.pathname.match(/^\/api\/account\/attachments\/([^/]+)\/default$/);
    if (attachmentDefaultMatch && request.method === 'POST') {
      return json(await setWorkspaceAttachmentDefault(
        rawDb,
        tenantContext,
        decodeURIComponent(attachmentDefaultMatch[1]),
        user.email || null,
      ));
    }

    const attachmentArchiveMatch = url.pathname.match(/^\/api\/account\/attachments\/([^/]+)\/archive$/);
    if (attachmentArchiveMatch && request.method === 'POST') {
      return json(await archiveWorkspaceAttachment(
        rawDb,
        tenantContext,
        decodeURIComponent(attachmentArchiveMatch[1]),
        user.email || null,
      ));
    }

    if (url.pathname === '/api/account/mailboxes' && request.method === 'GET') {
      return json(await listWorkspaceMailboxes(rawDb, tenantContext));
    }

    if (url.pathname === '/api/account/mailboxes/gmail/connect' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await beginGmailMailboxConnect(env, tenantContext, {
        redirect_path: body.redirect_path,
        request_origin: new URL(request.url).origin,
      }));
    }

    if (url.pathname === '/api/account/invites' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await createWorkspaceInvite(env, rawDb, tenantContext, body, user.email || null), 201);
    }

    if (url.pathname === '/api/account/users' && request.method === 'POST') {
      const body = await parseBody(request);
      return json(await createWorkspaceInvite(env, rawDb, tenantContext, body, user.email || null), 201);
    }

    const memberActionMatch = url.pathname.match(/^\/api\/account\/members\/([^/]+)\/(resend|disable|role|transfer-ownership)$/);
    if (memberActionMatch && request.method === 'POST') {
      const memberId = decodeURIComponent(memberActionMatch[1]);
      const action = memberActionMatch[2];
      const body = await parseBody(request);

      if (action === 'resend') {
        return json(await resendWorkspaceInvite(env, rawDb, tenantContext, memberId, user.email || null));
      }
      if (action === 'disable') {
        return json(await disableWorkspaceMember(rawDb, tenantContext, memberId, user.email || null));
      }
      if (action === 'role') {
        return json(await updateWorkspaceMemberRole(rawDb, tenantContext, memberId, body.role, user.email || null));
      }
      if (action === 'transfer-ownership') {
        return json(await transferWorkspaceOwnership(rawDb, tenantContext, memberId, user.email || null));
      }
    }

    if (url.pathname === '/api/billing/checkout' && request.method === 'POST') {
      return json(await createBillingCheckoutSession(env, rawDb, tenantContext));
    }

    if (url.pathname === '/api/billing/portal' && request.method === 'POST') {
      return json(await createBillingPortalSession(env, rawDb, tenantContext));
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
  }
}
