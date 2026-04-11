import { getAppConfig } from '../lib/config.mjs';
import { hasGmailAutomation } from '../lib/gmail.mjs';
import {
  runScheduledProspectPilot,
} from '../lib/prospects.mjs';
import { syncOutreachReplies } from '../lib/reply-sync.mjs';
import { listTenants, normalizeTenantFeatures } from '../lib/tenants.mjs';
import {
  buildSlotKey,
  isWeekdayInZone,
  matchesLocalClock,
} from '../lib/timezone.mjs';
import { createRun, completeRun, failRun } from '../lib/runs.mjs';
import { createSupabaseClient, withTenantScope } from '../lib/supabase.mjs';
import { backfillPermitFollowUps, processDueFollowUps } from './follow-up.mjs';
import { runAutomationCycle } from './engine.mjs';

async function runProspectSchedules(env, db, config, now, tenant = null) {
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
      tenant,
      mode: 'prospect_daily_send',
      slotKey: buildSlotKey('prospect_daily_send', now, timeZone),
    }));
    return results;
  }

  if (initialWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      tenant,
      mode: 'prospect_initial_send',
      slotKey: buildSlotKey('prospect_initial_send', now, timeZone),
    }));
  }

  if (followUpWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      tenant,
      mode: 'prospect_follow_up_send',
      slotKey: buildSlotKey('prospect_follow_up_send', now, timeZone),
    }));
  }

  return results;
}

function shouldRunPermitSchedule(now, timeZone = 'America/New_York') {
  return matchesLocalClock(now, timeZone, '07:00') || matchesLocalClock(now, timeZone, '18:00');
}

export async function runScheduledWork(env, now = new Date()) {
  const db = createSupabaseClient(env);
  const tenants = await listTenants(db).catch(() => []);
  const results = {
    prospects: [],
    permits: [],
    permit_follow_ups: [],
    permit_follow_up_backfill: [],
    reply_sync: null,
    tenants: {},
  };

  if (hasGmailAutomation(env)) {
    results.reply_sync = await syncOutreachReplies(env, db, {
      maxResults: 40,
      newerThanDays: 21,
    });
  }

  for (const tenant of tenants) {
    const tenantDb = withTenantScope(db, tenant.id);
    const config = await getAppConfig(tenantDb, tenant.id).catch(() => null);
    if (!config) {
      continue;
    }

    const features = normalizeTenantFeatures(tenant);
    const tenantResults = {
      prospects: [],
      permits: null,
      permit_follow_ups: null,
      permit_follow_up_backfill: null,
    };
    const permitWindow = shouldRunPermitSchedule(now, config.prospect_timezone || 'America/New_York');

    if (features.prospect_outreach && config.prospect_pilot_enabled) {
      tenantResults.prospects = await runProspectSchedules(env, tenantDb, config, now, tenant);
      if (tenantResults.prospects.length > 0) {
        results.prospects.push({
          tenant_id: tenant.id,
          tenant_slug: tenant.slug,
          runs: tenantResults.prospects,
        });
      }
    }

    if (features.permit_scanning && config.follow_up_enabled) {
      tenantResults.permit_follow_up_backfill = await backfillPermitFollowUps(tenantDb, config);
      results.permit_follow_up_backfill.push({
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        result: tenantResults.permit_follow_up_backfill,
      });
    }

    if (features.permit_scanning && config.permit_auto_send_enabled && permitWindow) {
      tenantResults.permits = await runAutomationCycle(env, {
        tenant,
        triggerType: 'schedule',
        triggeredBy: null,
      });
      results.permits.push({
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        result: tenantResults.permits,
      });
    }

    if (features.permit_scanning && config.follow_up_enabled && permitWindow) {
      tenantResults.permit_follow_ups = await processDueFollowUps(env, tenantDb, { tenant });
      results.permit_follow_ups.push({
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        result: tenantResults.permit_follow_ups,
      });
    }

    if (
      tenantResults.prospects.length > 0
      || tenantResults.permits
      || tenantResults.permit_follow_ups
      || tenantResults.permit_follow_up_backfill
    ) {
      results.tenants[tenant.slug] = tenantResults;
    }
  }

  return results;
}
