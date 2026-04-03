import { eq, order } from './supabase.mjs';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export async function getRecipientOutreachHistory(db, email) {
  const recipient = normalizeEmail(email);
  if (!recipient) {
    return [];
  }

  const [leadOutcomes, prospectOutcomes] = await Promise.all([
    db.select('v2_email_outcomes', {
      filters: [eq('email_address', recipient)],
      ordering: [order('sent_at', 'desc'), order('created_at', 'desc')],
      limit: 20,
    }).catch(() => []),
    db.select('v2_prospect_outcomes', {
      filters: [eq('email_address', recipient)],
      ordering: [order('sent_at', 'desc'), order('created_at', 'desc')],
      limit: 20,
    }).catch(() => []),
  ]);

  return [
    ...leadOutcomes.map((row) => ({ ...row, source_table: 'v2_email_outcomes' })),
    ...prospectOutcomes.map((row) => ({ ...row, source_table: 'v2_prospect_outcomes' })),
  ].sort((left, right) => {
    const leftTime = new Date(left.sent_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.sent_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
}

export async function getPriorOutreach(db, email) {
  const history = await getRecipientOutreachHistory(db, email);
  return history.find((row) => ['sent', 'delivered', 'opened', 'replied', 'opted_out', 'bounced', 'archived'].includes(String(row.outcome || '').toLowerCase())) || null;
}

export function formatPriorOutreachMessage(prior) {
  if (!prior) {
    return 'Recipient has already been contacted';
  }

  const sentAt = prior.sent_at || prior.created_at || null;
  const when = sentAt ? new Date(sentAt).toISOString().slice(0, 10) : 'an earlier date';
  return `Recipient ${prior.email_address} was already contacted on ${when}`;
}
