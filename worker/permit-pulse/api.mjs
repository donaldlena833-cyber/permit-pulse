import {
  enrichLeadNow,
  getPermitAutomationSnapshot,
  refreshLeadDraftNow,
  runEnrichmentBatch,
  runPermitIngest,
  runPermitAutomationCycle,
  sendLeadNow,
  updateLeadAutomationState,
} from './automation.mjs';
import { getDefaultAttachmentStatus } from './gmail.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function handlePermitPulseAutomationRequest(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/v2')) {
    return null;
  }

  if (request.method === 'OPTIONS') {
    return json({});
  }

  try {
    if (url.pathname === '/api/v2/health' && request.method === 'GET') {
      const attachment = await getDefaultAttachmentStatus(env);
      const supabaseAuthMode = env.SUPABASE_SERVICE_ROLE_KEY
        ? 'service_role'
        : env.SUPABASE_ANON_KEY
          ? 'anon'
          : 'missing';
      return json({
        ok: true,
        hasSupabase: Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)),
        supabaseAuthMode,
        hasGmail: Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN),
        hasBrave: Boolean(env.BRAVE_API_KEY),
        hasGoogleMaps: Boolean(env.GOOGLE_MAPS_API_KEY),
        hasFirecrawl: Boolean(env.FIRECRAWL_API_KEY),
        hasZeroBounce: Boolean(env.ZEROBOUNCE_API_KEY),
        hasDefaultAttachment: attachment.loaded,
        defaultAttachmentName: attachment.filename || null,
      });
    }

    if (url.pathname === '/api/v2/run' && request.method === 'POST') {
      const result = await runPermitAutomationCycle(env);
      return json(result);
    }

    if (url.pathname === '/api/v2/jobs/ingest' && request.method === 'POST') {
      const result = await runPermitIngest(env);
      return json(result);
    }

    if (url.pathname === '/api/v2/jobs/enrich' && request.method === 'POST') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '4', 10) || 4;
      const result = await runEnrichmentBatch(env, { limit });
      return json(result);
    }

    if (url.pathname === '/api/v2/state' && request.method === 'GET') {
      const snapshot = await getPermitAutomationSnapshot(env);
      return json(snapshot);
    }

    if (url.pathname === '/api/v2/sent-log' && request.method === 'GET') {
      const snapshot = await getPermitAutomationSnapshot(env);
      return json({ sentLog: snapshot.sentLog });
    }

    const statusMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'POST') {
      const patch = await request.json();
      const snapshot = await updateLeadAutomationState(env, decodeURIComponent(statusMatch[1]), {
        status: patch.status,
      });
      return json(snapshot);
    }

    const enrichmentMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/enrichment$/);
    if (enrichmentMatch && request.method === 'POST') {
      const patch = await request.json();
      const snapshot = await updateLeadAutomationState(env, decodeURIComponent(enrichmentMatch[1]), {
        enrichment: patch,
      });
      return json(snapshot);
    }

    const enrichLeadMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/enrich$/);
    if (enrichLeadMatch && request.method === 'POST') {
      const snapshot = await enrichLeadNow(env, decodeURIComponent(enrichLeadMatch[1]));
      return json(snapshot);
    }

    const draftMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/draft$/);
    if (draftMatch && request.method === 'POST') {
      const patch = await request.json();
      const snapshot = await updateLeadAutomationState(env, decodeURIComponent(draftMatch[1]), {
        draft: patch,
      });
      return json(snapshot);
    }

    const draftRefreshMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/draft\/refresh$/);
    if (draftRefreshMatch && request.method === 'POST') {
      const snapshot = await refreshLeadDraftNow(env, decodeURIComponent(draftRefreshMatch[1]));
      return json(snapshot);
    }

    const sendMatch = url.pathname.match(/^\/api\/v2\/leads\/([^/]+)\/send$/);
    if (sendMatch && request.method === 'POST') {
      const result = await sendLeadNow(env, decodeURIComponent(sendMatch[1]));
      return json(result);
    }

    return json(
      {
        error: 'Not found',
        endpoints: {
          'GET /api/v2/health': 'Automation health',
          'GET /api/v2/state': 'Full lead workspace snapshot',
          'GET /api/v2/sent-log': 'Sent outreach records',
          'POST /api/v2/run': 'Run ingest plus a small enrichment/send batch',
          'POST /api/v2/jobs/ingest': 'Run permit ingest only',
          'POST /api/v2/jobs/enrich?limit=4': 'Run a small enrichment batch',
          'POST /api/v2/leads/:id/status': 'Persist a lead status',
          'POST /api/v2/leads/:id/enrich': 'Run enrichment for one lead',
          'POST /api/v2/leads/:id/enrichment': 'Persist manual enrichment',
          'POST /api/v2/leads/:id/draft': 'Persist an outreach draft',
          'POST /api/v2/leads/:id/draft/refresh': 'Regenerate the latest outreach draft from resolver data',
          'POST /api/v2/leads/:id/send': 'Send the latest draft now',
        },
      },
      404,
    );
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Automation request failed',
      },
      500,
    );
  }
}

export { runPermitAutomationCycle };
