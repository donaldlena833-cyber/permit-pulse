import { nowIso } from './utils.mjs';

export async function appendLeadEvent(db, payload) {
  const [event] = await db.insert('v2_lead_events', {
    actor_type: 'system',
    created_at: nowIso(),
    ...payload,
  });

  return event || null;
}
