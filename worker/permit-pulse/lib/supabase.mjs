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

async function request(env, table, options = {}) {
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

  if (!response.ok) {
    throw new Error(`Supabase ${method} ${table} failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
  return {
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
  };
}
