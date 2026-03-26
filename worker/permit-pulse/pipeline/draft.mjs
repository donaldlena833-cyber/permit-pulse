import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';

function serviceFromLead(lead) {
  const keyword = String(lead.relevance_keyword || '').toLowerCase();
  if (keyword.includes('shower') || keyword.includes('bath')) return 'shower enclosure';
  if (keyword.includes('mirror')) return 'mirror wall';
  if (keyword.includes('partition')) return 'glass partition';
  if (keyword.includes('railing')) return 'glass railing';
  return 'glass scope';
}

export function chooseDraftCta(lead) {
  const relevance = Number(lead.relevance_score || 0);
  const service = serviceFromLead(lead);

  if (relevance >= 0.8) {
    return {
      type: 'pricing',
      sentence: `I put together a quick estimate for the ${service} at ${lead.address}.`,
    };
  }

  if (lead.contact_role === 'gc_applicant') {
    return {
      type: 'takeoff',
      sentence: 'Happy to do a free glass takeoff from plans if you send them over.',
    };
  }

  if (relevance >= 0.6) {
    return {
      type: 'similar_project',
      sentence: `We just finished a similar ${service} project nearby.`,
    };
  }

  return {
    type: 'quick_call',
    sentence: `Would 10 minutes work this week to walk through glass options for ${lead.address}?`,
  };
}

export function buildInitialDraft(lead) {
  const firstName = String(lead.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const cta = chooseDraftCta(lead);
  const service = serviceFromLead(lead);
  const subject = lead.address ? `Glass scope at ${lead.address}` : 'MetroGlass Pro glass support';
  const lines = [
    `Hi ${firstName},`,
    `I saw the permit filed for ${lead.address || 'your project'} and wanted to reach out from MetroGlass Pro.`,
    `We handle ${service}, mirrors, partitions, cabinets, and related installation work across NYC, NJ, and CT.`,
    cta.sentence,
    'If this is still being lined up, I would be glad to help.',
    'Best,',
    'Donald',
  ];

  return {
    subject,
    body: lines.join('\n\n'),
    cta_type: cta.type,
  };
}

export function buildFollowUpDraft(lead, stepNumber) {
  const firstName = String(lead.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const service = serviceFromLead(lead);

  if (stepNumber === 2) {
    return {
      subject: lead.draft_subject || `Following up on ${lead.address || 'your project'}`,
      body: [
        `Hi ${firstName},`,
        `Wanted to follow up on my note about the ${service} at ${lead.address || 'your project'}.`,
        'If it helps, we can turn around a quick number or review plans without a long handoff.',
        'Best,',
        'Donald',
      ].join('\n\n'),
    };
  }

  return {
    subject: lead.draft_subject || `Final follow up for ${lead.address || 'your project'}`,
    body: [
      `Hi ${firstName},`,
      'Just wanted to make sure this did not get buried.',
      `If the glass scope for ${lead.address || 'the project'} is still open, I would be happy to help.`,
      'Best,',
      'Donald',
    ].join('\n\n'),
  };
}

export async function generateLeadDraft(db, runId, leadId) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });

  if (!lead || !lead.address) {
    return null;
  }

  const draft = buildInitialDraft(lead);

  await db.update('v2_leads', [`id=eq.${leadId}`], {
    draft_subject: draft.subject,
    draft_body: draft.body,
    draft_cta_type: draft.cta_type,
    updated_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: leadId,
    run_id: runId,
    event_type: 'draft_generated',
    detail: draft,
  });

  return draft;
}
