import { nowIso } from './utils.mjs';

function isTransientEventWriteError(error) {
  const message = String(error instanceof Error ? error.message : error || '');
  return message.includes('POST v2_lead_events failed: 502')
    || message.includes('POST v2_lead_events failed: 503')
    || message.includes('POST v2_lead_events failed: 504');
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function appendLeadEvent(db, payload) {
  const eventPayload = {
    actor_type: 'system',
    created_at: nowIso(),
    ...payload,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [event] = await db.insert('v2_lead_events', eventPayload);
      return event || null;
    } catch (error) {
      if (!isTransientEventWriteError(error) || attempt === 2) {
        console.warn('Lead event write skipped', error instanceof Error ? error.message : String(error || 'Unknown error'));
        return null;
      }
      await wait(150 * (attempt + 1));
    }
  }

  return null;
}
