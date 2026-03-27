function buildUrl(env, table, query = '') {
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('SUPABASE_URL is not configured');
  }

  return `${base}/rest/v1/${table}${query}`;
}

function getSupabaseKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '';
}

function headers(env, extra = {}) {
  const key = getSupabaseKey(env);
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not configured');
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(env, table, { method = 'GET', query = '', body, extraHeaders } = {}) {
  const response = await fetch(buildUrl(env, table, query), {
    method,
    headers: headers(env, extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
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

function isMissingRelationError(error, table) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('42P01') ||
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(`relation "public.${table}" does not exist`) ||
    message.includes(`Could not find the table '${table}'`) ||
    message.includes(`Could not find the relation '${table}'`) ||
    message.includes(`Could not find the table 'public.${table}'`) ||
    message.includes(`Could not find the relation 'public.${table}'`) ||
    (message.includes('schema cache') && message.includes(table))
  );
}

function escapeValue(value) {
  return encodeURIComponent(String(value));
}

function eq(field, value) {
  return `${field}=eq.${escapeValue(value)}`;
}

function gt(field, value) {
  return `${field}=gt.${escapeValue(value)}`;
}

function gte(field, value) {
  return `${field}=gte.${escapeValue(value)}`;
}

function lt(field, value) {
  return `${field}=lt.${escapeValue(value)}`;
}

function order(field, direction = 'desc') {
  return `order=${field}.${direction}`;
}

function limit(value) {
  return `limit=${value}`;
}

function not(field, operator, value) {
  return `${field}=not.${operator}.${escapeValue(value)}`;
}

export function createSupabaseGateway(env) {
  return {
    async select(table, options = {}) {
      const {
        columns = '*',
        filters = [],
        ordering = [],
        pageLimit,
      } = options;

      const params = [`select=${encodeURIComponent(columns)}`, ...filters, ...ordering];
      if (pageLimit) {
        params.push(limit(pageLimit));
      }

      return (await request(env, table, {
        query: `?${params.join('&')}`,
      })) || [];
    },

    async insert(table, payload) {
      return (await request(env, table, {
        method: 'POST',
        body: Array.isArray(payload) ? payload : [payload],
        extraHeaders: { Prefer: 'return=representation' },
      })) || [];
    },

    async upsert(table, payload, onConflict) {
      const query = onConflict ? `?on_conflict=${onConflict}` : '';
      return (await request(env, table, {
        method: 'POST',
        query,
        body: Array.isArray(payload) ? payload : [payload],
        extraHeaders: {
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
      })) || [];
    },

    async patch(table, filters, payload) {
      return (await request(env, table, {
        method: 'PATCH',
        query: `?${filters.join('&')}`,
        body: payload,
        extraHeaders: { Prefer: 'return=representation' },
      })) || [];
    },

    async deleteWhere(table, filters) {
      return request(env, table, {
        method: 'DELETE',
        query: `?${filters.join('&')}`,
      });
    },

    async getLeadByPermitKey(permitKey) {
      return (await this.select('leads', {
        filters: [eq('permit_key', permitKey)],
        pageLimit: 1,
      }))[0] || null;
    },

    async getLeadById(leadId) {
      return (await this.select('leads', {
        filters: [eq('id', leadId)],
        pageLimit: 1,
      }))[0] || null;
    },

    async getQueueSnapshot() {
      const [leads, properties, companies, contacts, facts, outreach, activity, candidates, jobs] = await Promise.all([
        this.select('leads', {
          ordering: [order('priority_score', 'desc'), order('updated_at', 'desc')],
          pageLimit: 200,
        }),
        this.select('property_profiles', { pageLimit: 200 }),
        this.select('company_profiles', { pageLimit: 200 }),
        this.select('contacts', { ordering: [order('is_primary', 'desc'), order('confidence', 'desc')], pageLimit: 500 }),
        this.select('enrichment_facts', { ordering: [order('created_at', 'desc')], pageLimit: 1000 }),
        this.select('outreach', { ordering: [order('created_at', 'desc')], pageLimit: 500 }),
        this.select('activity_log', { ordering: [order('created_at', 'desc')], pageLimit: 1000 }),
        this.safeSelect('resolution_candidates', { ordering: [order('confidence', 'desc')], pageLimit: 1000 }),
        this.safeSelect('automation_jobs', { ordering: [order('created_at', 'desc')], pageLimit: 250 }),
      ]);

      return { leads, properties, companies, contacts, facts, outreach, activity, candidates, jobs };
    },

    async safeSelect(table, options = {}) {
      try {
        return await this.select(table, options);
      } catch (error) {
        if (isMissingRelationError(error, table)) {
          return [];
        }

        throw error;
      }
    },

    async countSentSince(isoDate) {
      const rows = await this.select('outreach', {
        columns: 'id',
        filters: [eq('status', 'sent'), gte('sent_at', isoDate)],
        pageLimit: 500,
      });
      return rows.length;
    },

    async hasDuplicateOutreach(recipient, sinceIsoDate) {
      if (!recipient) {
        return false;
      }

      const rows = await this.select('outreach', {
        columns: 'id',
        filters: [eq('recipient', recipient), gte('sent_at', sinceIsoDate), eq('status', 'sent')],
        pageLimit: 1,
      });
      return rows.length > 0;
    },

    async replaceContacts(leadId, contacts) {
      await this.deleteWhere('contacts', [eq('lead_id', leadId)]);
      if (contacts.length === 0) {
        return [];
      }

      return this.insert('contacts', contacts.map((contact) => ({ ...contact, lead_id: leadId })));
    },

    async replaceFacts(leadId, facts) {
      await this.deleteWhere('enrichment_facts', [eq('lead_id', leadId)]);
      if (facts.length === 0) {
        return [];
      }

      return this.insert(
        'enrichment_facts',
        facts.map((fact) => ({ ...fact, lead_id: leadId })),
      );
    },

    async replaceResolutionCandidates(leadId, candidates) {
      try {
        await this.deleteWhere('resolution_candidates', [eq('lead_id', leadId)]);
      } catch (error) {
        if (isMissingRelationError(error, 'resolution_candidates')) {
          return [];
        }

        throw error;
      }

      if (candidates.length === 0) {
        return [];
      }

      try {
        return this.insert(
          'resolution_candidates',
          candidates.map((candidate) => ({ ...candidate, lead_id: leadId })),
        );
      } catch (error) {
        if (isMissingRelationError(error, 'resolution_candidates')) {
          return [];
        }

        throw error;
      }
    },

    async getResolutionCandidates(leadId) {
      return this.safeSelect('resolution_candidates', {
        filters: [eq('lead_id', leadId)],
        ordering: [order('confidence', 'desc')],
        pageLimit: 100,
      });
    },

    async getAutomationJobById(jobId) {
      return (await this.safeSelect('automation_jobs', {
        filters: [eq('id', jobId)],
        pageLimit: 1,
      }))[0] || null;
    },

    async getAutomationJobs(options = {}) {
      const {
        runId,
        leadId,
        statuses = [],
        pageLimit = 100,
      } = options;

      const filters = [];
      if (runId) {
        filters.push(eq('run_id', runId));
      }
      if (leadId) {
        filters.push(eq('lead_id', leadId));
      }
      if (statuses.length === 1) {
        filters.push(eq('status', statuses[0]));
      }

      const rows = await this.safeSelect('automation_jobs', {
        filters,
        ordering: [order('created_at', 'desc')],
        pageLimit,
      });

      return statuses.length <= 1
        ? rows
        : rows.filter((row) => statuses.includes(row.status));
    },

    async getRunnableAutomationJobs(nowIso, pageLimit = 16) {
      const [queued, retrying] = await Promise.all([
        this.safeSelect('automation_jobs', {
          filters: [eq('status', 'queued')],
          ordering: [order('created_at', 'asc')],
          pageLimit,
        }),
        this.safeSelect('automation_jobs', {
          filters: [eq('status', 'retrying')],
          ordering: [order('created_at', 'asc')],
          pageLimit,
        }),
      ]);

      return [...queued, ...retrying]
        .filter((job) => !job.next_retry_at || job.next_retry_at <= nowIso)
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
        .slice(0, pageLimit);
    },

    async getRunChildren(runId, options = {}) {
      const { excludeJobId = null, pageLimit = 500 } = options;
      const filters = [eq('run_id', runId)];
      if (excludeJobId) {
        filters.push(not('id', 'eq', excludeJobId));
      }

      return this.safeSelect('automation_jobs', {
        filters,
        ordering: [order('created_at', 'asc')],
        pageLimit,
      });
    },

    async safeInsertAutomationJob(payload) {
      try {
        return await this.insert('automation_jobs', payload);
      } catch (error) {
        if (isMissingRelationError(error, 'automation_jobs')) {
          return [];
        }

        throw error;
      }
    },

    async safePatchAutomationJob(jobId, payload) {
      try {
        return await this.patch('automation_jobs', [eq('id', jobId)], payload);
      } catch (error) {
        if (isMissingRelationError(error, 'automation_jobs')) {
          return [];
        }

        throw error;
      }
    },

    async patchResolutionCandidate(candidateId, payload) {
      try {
        return await this.patch('resolution_candidates', [eq('id', candidateId)], payload);
      } catch (error) {
        if (isMissingRelationError(error, 'resolution_candidates')) {
          return [];
        }

        throw error;
      }
    },

    eq,
    gt,
    gte,
    lt,
    not,
    order,
    limit,
  };
}

export { eq, gt, gte, lt, not, order, limit };
