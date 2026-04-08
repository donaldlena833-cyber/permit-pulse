import { getAppConfig } from '../lib/config.mjs';
import { hasGmailAutomation } from '../lib/gmail.mjs';
import { listActiveTenants } from '../lib/account.mjs';
import {
  runScheduledProspectPilot,
} from '../lib/prospects.mjs';
import { syncOutreachReplies } from '../lib/reply-sync.mjs';
import { createTenantScopedDb, resolveSharedProspectTenantId } from '../lib/tenant-db.mjs';
import {
  buildSlotKey,
  isWeekdayInZone,
  matchesLocalClock,
} from '../lib/timezone.mjs';
import { createRun, completeRun, failRun } from '../lib/runs.mjs';
import { createSupabaseClient } from '../lib/supabase.mjs';
import { backfillPermitFollowUps, processDueFollowUps } from './follow-up.mjs';
import { runAutomationCycle } from './engine.mjs';

async function runProspectSchedules(env, db, config, now, tenant) {
  const timeZone = config.prospect_timezone || 'America/New_York';
  if (!isWeekdayInZone(now, timeZone)) {
    return [];
  }

  const results = [];
  const initialTime = config.prospect_initial_send_time || '11:00';
  const followUpTime = config.prospect_follow_up_send_time || initialTime;
  const initialWindow = matchesLocalClock(now, timeZone, initialTime);
  const followUpWindow = matchesLocalClock(now, timeZone, followUpTime);

  if (initialWindow && followUpWindow && initialTime === followUpTime) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      mode: 'prospect_daily_send',
      slotKey: buildSlotKey('prospect_daily_send', now, timeZone),
      workspace: tenant,
    }));
    return results;
  }

  if (initialWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      mode: 'prospect_initial_send',
      slotKey: buildSlotKey('prospect_initial_send', now, timeZone),
      workspace: tenant,
    }));
  }

  if (followUpWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      mode: 'prospect_follow_up_send',
      slotKey: buildSlotKey('prospect_follow_up_send', now, timeZone),
      workspace: tenant,
    }));
  }

  return results;
}

function shouldRunPermitSchedule(now, timeZone = 'America/New_York') {
  return matchesLocalClock(now, timeZone, '07:00') || matchesLocalClock(now, timeZone, '18:00');
}

export async function runScheduledWork(env, now = new Date()) {
  const rawDb = createSupabaseClient(env);
  const tenants = await listActiveTenants(rawDb);
  const sharedProspectTenantId = await resolveSharedProspectTenantId(rawDb, tenants[0]?.id || null);
  const results = {
    workspaces: [],
  };

  for (const tenant of tenants) {
    const db = createTenantScopedDb(rawDb, tenant.id, {
      sharedProspectTenantId,
    });
    const config = await getAppConfig(db);
    const hasWorkspaceMailbox = Boolean(tenant?.default_mailbox?.email);
    const ownsSharedProspects = !sharedProspectTenantId || tenant.id === sharedProspectTenantId;
    const tenantResults = {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
      },
      prospects: [],
      permits: null,
      permit_follow_ups: null,
      permit_follow_up_backfill: null,
      reply_sync: null,
    };

    if (hasGmailAutomation(env) && ownsSharedProspects && hasWorkspaceMailbox) {
      tenantResults.reply_sync = await syncOutreachReplies(env, db, {
        maxResults: 40,
        newerThanDays: 21,
        queueUnmatched: false,
        scopeKey: sharedProspectTenantId || tenant.id,
        mailbox: tenant.default_mailbox,
      });
    }

    if (config.prospect_pilot_enabled && ownsSharedProspects && hasWorkspaceMailbox) {
      tenantResults.prospects = await runProspectSchedules(env, db, config, now, tenant);
    }

    if (config.follow_up_enabled) {
      tenantResults.permit_follow_up_backfill = await backfillPermitFollowUps(db, config);
    }

    if (config.permit_auto_send_enabled && hasWorkspaceMailbox && shouldRunPermitSchedule(now, config.prospect_timezone || 'America/New_York')) {
      tenantResults.permits = await runAutomationCycle(env, {
        db,
        triggerType: 'schedule',
        triggeredBy: null,
        workspace: tenant,
      });
    }

    if (config.follow_up_enabled && hasWorkspaceMailbox && shouldRunPermitSchedule(now, config.prospect_timezone || 'America/New_York')) {
      tenantResults.permit_follow_ups = await processDueFollowUps(env, db, {
        workspace: tenant,
      });
    }

    results.workspaces.push(tenantResults);
  }

  return results;
}
