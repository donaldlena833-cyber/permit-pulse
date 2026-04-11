function baseUrl(env) {
  const value = env.SUPABASE_URL?.replace(/\/$/, '');
  if (!value) {
    throw new Error('SUPABASE_URL is not configured');
  }
  return value;
}

function serviceKey(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '';
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not configured');
  }
  return key;
}

function buildHeaders(env, extraHeaders = {}) {
  const key = serviceKey(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
}

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

const TENANT_SCOPED_TABLES = new Set([
  'v2_prospects',
  'v2_prospect_import_batches',
  'v2_prospect_events',
  'v2_prospect_outcomes',
  'v2_prospect_follow_ups',
  'v2_prospect_companies',
  'v2_prospect_campaigns',
  'v2_prospect_suppressions',
  'v2_outreach_review_queue',
  'v2_leads',
  'v2_automation_runs',
  'v2_lead_events',
  'v2_lead_jobs',
  'v2_email_candidates',
  'v2_company_candidates',
  'v2_email_outcomes',
  'v2_follow_ups',
  'v2_related_permits',
  'v2_app_config',
  'v2_tenant_email_templates',
  'v2_tenant_gmail_credentials',
]);

const TENANT_ON_CONFLICT = {
  v2_app_config: 'tenant_id,key',
  v2_prospects: 'tenant_id,email_normalized',
  v2_tenant_gmail_credentials: 'tenant_id',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(method, status) {
  return method === 'GET' && [502, 503, 504].includes(Number(status || 0));
}

async function requestOnce(env, table, options = {}) {
  const {
    method = 'GET',
    query = '',
    body,
    headers,
  } = options;

  const response = await fetch(`${baseUrl(env)}/rest/v1/${table}${query}`, {
    method,
    headers: buildHeaders(env, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return response;
}

async function request(env, table, options = {}) {
  const method = options.method || 'GET';
  const retryDelaysMs = [250, 900];
  let attempt = 0;

  while (true) {
    const response = await requestOnce(env, table, options);

    if (response.ok) {
      if (response.status === 204) {
        return null;
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }

    if (shouldRetry(method, response.status) && attempt < retryDelaysMs.length) {
      await delay(retryDelaysMs[attempt]);
      attempt += 1;
      continue;
    }

    throw new Error(`Supabase ${method} ${table} failed: ${response.status} ${await response.text()}`);
  }
}

export function eq(field, value) {
  return `${field}=eq.${encodeURIComponent(String(value))}`;
}

export function neq(field, value) {
  return `${field}=neq.${encodeURIComponent(String(value))}`;
}

export function inList(field, values) {
  return `${field}=in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')})`;
}

export function ilike(field, value) {
  return `${field}=ilike.${encodeURIComponent(value)}`;
}

export function lte(field, value) {
  return `${field}=lte.${encodeURIComponent(String(value))}`;
}

export function gte(field, value) {
  return `${field}=gte.${encodeURIComponent(String(value))}`;
}

export function order(field, direction = 'desc', nulls = 'last') {
  return `order=${field}.${direction}.nulls${nulls}`;
}

export function createSupabaseClient(env) {
  const client = {
    async select(table, options = {}) {
      const {
        columns = '*',
        filters = [],
        ordering = [],
        limit,
        offset,
      } = options;

      const queryBits = [`select=${encodeURIComponent(columns)}`, ...filters, ...ordering];
      if (limit !== undefined) {
        queryBits.push(`limit=${limit}`);
      }
      if (offset !== undefined) {
        queryBits.push(`offset=${offset}`);
      }

      return (await request(env, table, {
        query: `?${queryBits.join('&')}`,
      })) || [];
    },

    async single(table, options = {}) {
      const rows = await this.select(table, { ...options, limit: 1 });
      return rows[0] || null;
    },

    async insert(table, payload, prefer = 'return=representation') {
      return (await request(env, table, {
        method: 'POST',
        body: Array.isArray(payload) ? payload : [payload],
        headers: { Prefer: prefer },
      })) || [];
    },

    async update(table, filters, payload) {
      return (await request(env, table, {
        method: 'PATCH',
        query: `?${filters.join('&')}`,
        body: payload,
        headers: { Prefer: 'return=representation' },
      })) || [];
    },

    async upsert(table, payload, onConflict = '') {
      const query = onConflict ? buildQuery({ on_conflict: onConflict }) : '';
      return (await request(env, table, {
        method: 'POST',
        query,
        body: Array.isArray(payload) ? payload : [payload],
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
      })) || [];
    },

    async remove(table, filters) {
      return request(env, table, {
        method: 'DELETE',
        query: `?${filters.join('&')}`,
      });
    },

    async rpc(fn, args = {}) {
      return request(env, `rpc/${fn}`, {
        method: 'POST',
        body: args,
      });
    },
  };

  return client;
}

function hasTenantFilter(filters = []) {
  return filters.some((filter) => String(filter || '').startsWith('tenant_id='));
}

function scopedFilters(table, tenantId, filters = []) {
  if (!tenantId || !TENANT_SCOPED_TABLES.has(table) || hasTenantFilter(filters)) {
    return filters;
  }

  return [eq('tenant_id', tenantId), ...filters];
}

function scopedPayload(table, tenantId, payload) {
  if (!tenantId || !TENANT_SCOPED_TABLES.has(table)) {
    return payload;
  }

  const applyTenant = (row) => ({
    ...(row || {}),
    tenant_id: row?.tenant_id || tenantId,
  });

  return Array.isArray(payload) ? payload.map(applyTenant) : applyTenant(payload);
}

function scopedOnConflict(table, onConflict = '') {
  if (!TENANT_SCOPED_TABLES.has(table)) {
    return onConflict;
  }

  if (onConflict && onConflict.includes('tenant_id')) {
    return onConflict;
  }

  return TENANT_ON_CONFLICT[table] || onConflict;
}

export function withTenantScope(db, tenantId) {
  if (!tenantId) {
    return db;
  }

  return {
    tenantId,

    async select(table, options = {}) {
      return db.select(table, {
        ...options,
        filters: scopedFilters(table, tenantId, options.filters || []),
      });
    },

    async single(table, options = {}) {
      return db.single(table, {
        ...options,
        filters: scopedFilters(table, tenantId, options.filters || []),
      });
    },

    async insert(table, payload, prefer) {
      return db.insert(table, scopedPayload(table, tenantId, payload), prefer);
    },

    async update(table, filters, payload) {
      return db.update(
        table,
        scopedFilters(table, tenantId, filters || []),
        scopedPayload(table, tenantId, payload),
      );
    },

    async upsert(table, payload, onConflict = '') {
      return db.upsert(
        table,
        scopedPayload(table, tenantId, payload),
        scopedOnConflict(table, onConflict),
      );
    },

    async remove(table, filters) {
      return db.remove(table, scopedFilters(table, tenantId, filters || []));
    },

    async rpc(fn, args = {}) {
      return db.rpc(fn, args);
    },
  };
}
