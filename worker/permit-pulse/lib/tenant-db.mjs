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

const LEGACY_UNSCOPED_TABLES = new Set();

function normalizeTableName(table) {
  return String(table || '').trim();
}

export function isTenantScopedTable(table) {
  return TENANT_SCOPED_TABLES.has(normalizeTableName(table));
}

function isTenantColumnMissing(error) {
  const message = String(error?.message || '');
  return message.includes('tenant_id');
}

function shouldUseTenantScope(table) {
  const name = normalizeTableName(table);
  return isTenantScopedTable(name) && !LEGACY_UNSCOPED_TABLES.has(name);
}

function markLegacyUnscopedTable(table) {
  LEGACY_UNSCOPED_TABLES.add(normalizeTableName(table));
}

function scopedTenantIdForTable(table, tenantId, options = {}) {
  const name = normalizeTableName(table);
  if (SHARED_PROSPECT_TABLES.has(name) && options.sharedProspectTenantId) {
    return options.sharedProspectTenantId;
  }

  return tenantId;
}

function withTenantFilters(table, tenantId, filters = [], options = {}) {
  if (!shouldUseTenantScope(table)) {
    return filters;
  }

  return [...filters, eq('tenant_id', scopedTenantIdForTable(table, tenantId, options))];
}

function withTenantPayload(table, tenantId, payload, options = {}) {
  if (!shouldUseTenantScope(table)) {
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
  if (!shouldUseTenantScope(table) || !onConflict || onConflict.includes('tenant_id') || onConflict === 'id') {
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

  return {
    tenant_id: tenantId,
    raw: db,

    async select(table, options = {}) {
      const scopedQuery = () => db.select(table, {
        ...options,
        filters: withTenantFilters(table, tenantId, options.filters || [], scopedOptions),
      });

      try {
        return await scopedQuery();
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.select(table, options);
      }
    },

    async single(table, options = {}) {
      const scopedQuery = () => db.single(table, {
        ...options,
        filters: withTenantFilters(table, tenantId, options.filters || [], scopedOptions),
      });

      try {
        return await scopedQuery();
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.single(table, options);
      }
    },

    async insert(table, payload, prefer) {
      const scopedPayload = withTenantPayload(table, tenantId, payload, scopedOptions);
      try {
        return await db.insert(table, scopedPayload, prefer);
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.insert(table, payload, prefer);
      }
    },

    async update(table, filters, payload) {
      const scopedFilters = withTenantFilters(table, tenantId, filters || [], scopedOptions);
      try {
        return await db.update(table, scopedFilters, payload);
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.update(table, filters || [], payload);
      }
    },

    async upsert(table, payload, onConflict = '') {
      const scopedPayload = withTenantPayload(table, tenantId, payload, scopedOptions);
      const scopedConflict = tenantScopedConflict(table, onConflict);
      try {
        return await db.upsert(table, scopedPayload, scopedConflict);
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.upsert(table, payload, onConflict);
      }
    },

    async remove(table, filters) {
      const scopedFilters = withTenantFilters(table, tenantId, filters || [], scopedOptions);
      try {
        return await db.remove(table, scopedFilters);
      } catch (error) {
        if (!isTenantColumnMissing(error)) {
          throw error;
        }
        markLegacyUnscopedTable(table);
        return db.remove(table, filters || []);
      }
    },
  };
}
