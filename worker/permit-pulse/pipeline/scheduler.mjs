import { getAppConfig } from '../lib/config.mjs';
import { hasGmailAutomation } from '../lib/gmail.mjs';
import {
  runScheduledProspectPilot,
} from '../lib/prospects.mjs';
import { syncOutreachReplies } from '../lib/reply-sync.mjs';
import {
  buildSlotKey,
  isWeekdayInZone,
  matchesLocalClock,
} from '../lib/timezone.mjs';
import { createRun, completeRun, failRun } from '../lib/runs.mjs';
import { createSupabaseClient } from '../lib/supabase.mjs';
import { backfillPermitFollowUps, processDueFollowUps } from './follow-up.mjs';
import { runAutomationCycle } from './engine.mjs';

async function runProspectSchedules(env, db, config, now) {
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
    }));
    return results;
  }

  if (initialWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
      mode: 'prospect_initial_send',
      slotKey: buildSlotKey('prospect_initial_send', now, timeZone),
    }));
  }

  if (followUpWindow) {
    results.push(await runScheduledProspectPilot(env, db, createRun, completeRun, failRun, {
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
  const config = await getAppConfig(db);
  const results = {
    prospects: [],
    permits: null,
    permit_follow_ups: null,
    permit_follow_up_backfill: null,
    reply_sync: null,
  };

  if (hasGmailAutomation(env)) {
    results.reply_sync = await syncOutreachReplies(env, db, {
      maxResults: 40,
      newerThanDays: 21,
    });
  }

  if (config.prospect_pilot_enabled) {
    results.prospects = await runProspectSchedules(env, db, config, now);
  }

  if (config.follow_up_enabled) {
    results.permit_follow_up_backfill = await backfillPermitFollowUps(db, config);
  }

  if (config.permit_auto_send_enabled && shouldRunPermitSchedule(now, config.prospect_timezone || 'America/New_York')) {
    results.permits = await runAutomationCycle(env, {
      triggerType: 'schedule',
      triggeredBy: null,
    });
  }

  if (config.follow_up_enabled && shouldRunPermitSchedule(now, config.prospect_timezone || 'America/New_York')) {
    results.permit_follow_ups = await processDueFollowUps(env, db);
  }

  return results;
}
