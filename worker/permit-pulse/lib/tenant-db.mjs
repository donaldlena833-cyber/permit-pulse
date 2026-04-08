import { eq } from './supabase.mjs';

export const SHARED_PROSPECT_TABLES = new Set([
  'v2_prospect_import_batches',
  'v2_prospects',
  'v2_prospect_events',
  'v2_prospect_outcomes',
  'v2_prospect_follow_ups',
  'v2_prospect_companies',
  'v2_prospect_campaigns',
  'v2_prospect_suppressions',
  'v2_outreach_review_queue',
]);

export const TENANT_SCOPED_TABLES = new Set([
  'v2_tenant_app_config',
  'v2_tenant_users',
  'v2_leads',
  'v2_automation_runs',
  'v2_company_candidates',
  'v2_email_candidates',
  'v2_lead_events',
  'v2_lead_jobs',
  'v2_email_outcomes',
  'v2_domain_reputation',
  'v2_follow_ups',
  'v2_related_permits',
  'v2_workspace_onboarding',
  'v2_workspace_attachments',
  'v2_workspace_mailboxes',
  'v2_audit_events',
  ...SHARED_PROSPECT_TABLES,
]);

export function isTenantScopedTable(table) {
  return TENANT_SCOPED_TABLES.has(String(table || '').trim());
}

function isTenantColumnMissing(error) {
  const message = String(error?.message || '');
  return message.includes('tenant_id')
    || message.includes('42703');
}

function migrationRequiredError(table, error) {
  const message = String(error?.message || '');
  return new Error(
    `Tenant migration required for ${table}: expected tenant_id-scoped schema but received ${message || 'a tenant scoping error'}`,
  );
}

function scopedTenantIdForTable(table, tenantId, options = {}) {
  const name = String(table || '').trim();
  if (SHARED_PROSPECT_TABLES.has(name) && options.sharedProspectTenantId) {
    return options.sharedProspectTenantId;
  }

  return tenantId;
}

function withTenantFilters(table, tenantId, filters = [], options = {}) {
  if (!isTenantScopedTable(table)) {
    return filters;
  }

  return [...filters, eq('tenant_id', scopedTenantIdForTable(table, tenantId, options))];
}

function withTenantPayload(table, tenantId, payload, options = {}) {
  if (!isTenantScopedTable(table)) {
    return payload;
  }

  const scopedTenantId = scopedTenantIdForTable(table, tenantId, options);

  if (Array.isArray(payload)) {
    return payload.map((row) => ({ tenant_id: scopedTenantId, ...row }));
  }

  return {
    tenant_id: scopedTenantId,
    ...(payload || {}),
  };
}

function tenantScopedConflict(table, onConflict = '') {
  if (!isTenantScopedTable(table) || !onConflict || onConflict.includes('tenant_id') || onConflict === 'id') {
    return onConflict;
  }

  return `tenant_id,${onConflict}`;
}

export async function resolveSharedProspectTenantId(db, fallbackTenantId = null) {
  try {
    const tenant = await db.single('v2_tenants', {
      filters: [eq('slug', 'metroglasspro')],
    });
    return tenant?.id || fallbackTenantId;
  } catch {
    return fallbackTenantId;
  }
}

export function createTenantScopedDb(db, tenantId, options = {}) {
  const scopedOptions = {
    sharedProspectTenantId: options.sharedProspectTenantId || null,
  };

  async function withTenantGuard(table, runScoped) {
    try {
      return await runScoped();
    } catch (error) {
      if (!isTenantColumnMissing(error)) {
        throw error;
      }
      throw migrationRequiredError(table, error);
    }
  }

  return {
    tenant_id: tenantId,
    raw: db,

    async select(table, options = {}) {
      return withTenantGuard(table,
        () => db.select(table, {
          ...options,
          filters: withTenantFilters(table, tenantId, options.filters || [], scopedOptions),
        }),
      );
    },

    async single(table, options = {}) {
      return withTenantGuard(table,
        () => db.single(table, {
          ...options,
          filters: withTenantFilters(table, tenantId, options.filters || [], scopedOptions),
        }),
      );
    },

    async insert(table, payload, prefer) {
      return withTenantGuard(table,
        () => db.insert(table, withTenantPayload(table, tenantId, payload, scopedOptions), prefer),
      );
    },

    async update(table, filters, payload) {
      return withTenantGuard(table,
        () => db.update(table, withTenantFilters(table, tenantId, filters || [], scopedOptions), payload),
      );
    },

    async upsert(table, payload, onConflict = '') {
      const scopedPayload = withTenantPayload(table, tenantId, payload, scopedOptions);
      const scopedConflict = tenantScopedConflict(table, onConflict);
      return withTenantGuard(table,
        () => db.upsert(table, scopedPayload, scopedConflict),
      );
    },

    async remove(table, filters) {
      return withTenantGuard(table,
        () => db.remove(table, withTenantFilters(table, tenantId, filters || [], scopedOptions)),
      );
    },
  };
}
