const DEFAULT_CONFIG = {
  daily_send_cap: 100,
  min_relevance_threshold: 0.15,
  scan_window_days: 14,
  scan_limit_per_source: 0,
  auto_send_trust_threshold: 50,
  manual_send_trust_threshold: 25,
  follow_up_enabled: true,
  follow_up_sequence: ['email:0', 'email:4', 'phone:7', 'email:14'],
  active_sources: ['nyc_dob'],
  warm_up_mode: false,
  warm_up_daily_cap: 100,
};

function parseValue(value) {
  if (Array.isArray(value) || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return '';
    }

    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return value;
}

export async function getAppConfig(db) {
  const rows = await db.select('v2_app_config', {
    columns: 'key,value,updated_at',
  });

  const mapped = { ...DEFAULT_CONFIG };

  for (const row of rows) {
    mapped[row.key] = parseValue(row.value);
  }

  mapped.daily_send_cap = Math.max(Number(mapped.daily_send_cap || 0), DEFAULT_CONFIG.daily_send_cap);
  mapped.warm_up_daily_cap = Math.max(Number(mapped.warm_up_daily_cap || 0), DEFAULT_CONFIG.warm_up_daily_cap);

  return mapped;
}

export const APP_CONFIG_DEFAULTS = DEFAULT_CONFIG;
