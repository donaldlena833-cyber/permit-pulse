import { eq, order } from './supabase.mjs';

function compactText(value) {
  return String(value || '').trim();
}

function sanitizeDetail(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return null;
  }

  return detail;
}

function isMissingRelationError(error, tableName) {
  const message = String(error?.message || '');
  return message.includes(tableName) && (message.includes('does not exist') || message.includes('relation'));
}

export async function appendAuditEvent(db, payload = {}) {
  const tenantId = compactText(payload.tenant_id || payload.tenantId || db?.tenant_id);
  if (!tenantId) {
    throw new Error('Audit events require a tenant context');
  }

  try {
    const [row] = await db.insert('v2_audit_events', {
      tenant_id: tenantId,
      actor_type: compactText(payload.actor_type || payload.actorType || 'system') || 'system',
      actor_id: compactText(payload.actor_id || payload.actorId) || null,
      event_type: compactText(payload.event_type || payload.eventType),
      target_type: compactText(payload.target_type || payload.targetType) || null,
      target_id: compactText(payload.target_id || payload.targetId) || null,
      detail: sanitizeDetail(payload.detail),
      created_at: new Date().toISOString(),
    });

    return row || null;
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_audit_events')) {
      throw error;
    }

    return null;
  }
}

export async function listAuditEvents(db, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 20), 1), 100);
  const page = Math.max(Number(options.page || 1), 1);
  const filters = [];

  if (options.eventType) {
    filters.push(eq('event_type', options.eventType));
  }

  let rows = [];
  try {
    rows = await db.select('v2_audit_events', {
      filters,
      ordering: [order('created_at', 'desc')],
      limit,
      offset: (page - 1) * limit,
    });
  } catch (error) {
    if (!isMissingRelationError(error, 'v2_audit_events')) {
      throw error;
    }
  }

  return {
    events: rows,
    page,
    limit,
  };
}
