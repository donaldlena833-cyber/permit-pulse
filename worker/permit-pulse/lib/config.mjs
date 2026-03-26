const DEFAULT_CONFIG = {
  daily_send_cap: 20,
  min_relevance_threshold: 0.15,
  auto_send_trust_threshold: 50,
  manual_send_trust_threshold: 25,
  follow_up_enabled: true,
  follow_up_sequence: ['email:0', 'email:4', 'phone:7', 'email:14'],
  active_sources: ['nyc_dob'],
  warm_up_mode: false,
  warm_up_daily_cap: 5,
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

  return mapped;
}

export const APP_CONFIG_DEFAULTS = DEFAULT_CONFIG;
