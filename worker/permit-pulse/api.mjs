import { getDefaultAttachmentStatus, hasGmailAutomation } from './lib/gmail.mjs';
import { createSupabaseClient, eq, order } from './lib/supabase.mjs';
import { getAppConfig } from './lib/config.mjs';
import { getLatestRuns, getRunById, enrichLead, startAutomationCycle } from './pipeline/engine.mjs';
import { generateLeadDraft } from './pipeline/draft.mjs';
import { sendLead, sendReadyLeads } from './pipeline/send.mjs';
import { logPhoneFollowUp, sendFollowUp, skipFollowUp } from './pipeline/follow-up.mjs';
import {
  addManualLeadEmail,
  chooseLeadEmailCandidate,
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

function isPublishedContact(candidate) {
  return candidate?.provenance_source !== 'pattern_guess';
}

function isSendApproved(candidate) {
  return Boolean(candidate?.is_auto_sendable || candidate?.is_manual_sendable);
}

async function getTodayPayload(env) {
  const db = createSupabaseClient(env);
  const config = await getAppConfig(db);
  const { currentRun, lastRun } = await getLatestRuns(env);
  const [newLeads, readyLeads, reviewLeads, followUps, sentOutcomes] = await Promise.all([
    db.select('v2_leads', {
      filters: [eq('status', 'new')],
      ordering: [order('updated_at', 'desc')],
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
      limit: 20,
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
    current_run: currentRun
      ? {
          id: currentRun.id,
          status: currentRun.status,
          current_stage: currentRun.current_stage,
          started_at: currentRun.started_at,
          counters: {
            permits_found: currentRun.permits_found,
            leads_created: currentRun.leads_created,
            leads_ready: currentRun.leads_ready,
            leads_review: currentRun.leads_review,
          },
        }
      : null,
    last_run: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          summary: {
            permits_found: lastRun.permits_found,
            leads_created: lastRun.leads_created,
            leads_ready: lastRun.leads_ready,
            leads_review: lastRun.leads_review,
            sends_succeeded: lastRun.sends_succeeded,
          },
          completed_at: lastRun.completed_at,
        }
      : null,
    counts: {
      new: newLeads.length,
      ready: readyLeads.length,
      review: reviewLeads.length,
    },
    new_leads: newLeads,
    ready: readyLeads,
    review: reviewLeads,
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
    lead,
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
  if (status && status !== 'all') {
    filters.push(eq('status', status));
  }

  const leads = await db.select('v2_leads', {
    filters,
    ordering: [order('updated_at', 'desc')],
    limit: page * limit,
  });

  const sorted = [...leads]
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
      const { run, task } = await startAutomationCycle(env, {
        triggerType: 'operator',
        triggeredBy: user.email || null,
      });

      if (ctx?.waitUntil) {
        ctx.waitUntil(task.catch((error) => {
          console.error('Automation run failed', error);
        }));
        return json({
          started: true,
          run_id: run.id,
        });
      }

      return json(await task.catch((error) => {
        console.error('Automation run failed', error);
        throw error;
      }));
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
      return json(run || { error: 'Run not found' }, run ? 200 : 404);
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
      const [recentFailures, totalLeads, domainHealth, runs] = await Promise.all([
        db.select('v2_lead_jobs', {
          filters: [eq('status', 'failed')],
          ordering: [order('created_at', 'desc')],
          limit: 5,
        }),
        db.select('v2_leads', { columns: 'id' }),
        db.select('v2_domain_health', { columns: 'domain,health_score,checked_at', limit: 20 }),
        db.select('v2_automation_runs', {
          ordering: [order('created_at', 'desc')],
          limit: 5,
        }),
      ]);

      return json({
        worker: {
          ok: true,
          has_gmail: hasGmailAutomation(env),
        },
        total_leads: totalLeads.length,
        recent_failures: recentFailures,
        domain_health: domainHealth,
        recent_runs: runs,
      });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
  }
}
