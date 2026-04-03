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
  const address = lead.address || 'your project';
  const subject = lead.address ? `Quick note on ${lead.address}` : 'Quick note from MetroGlass Pro';
  const lines = [
    `Hi ${firstName},`,
    `I saw the filing for ${address} and wanted to reach out.`,
    "I'm with MetroGlass Pro. We work on custom glass installations across NYC, NJ, and CT, including mirrors, partitions, shower glass, cabinets, and similar scope.",
    "I know filings do not always show the full picture, but if any glass related work is still being lined up, I'd be happy to connect.",
    'Best,',
    'Donald',
  ];

  return {
    subject,
    body: lines.join('\n\n'),
    cta_type: 'soft_intro',
  };
}

export function buildFollowUpDraft(lead, stepNumber) {
  const firstName = String(lead.contact_name || '').trim().split(/\s+/)[0] || 'there';
  const service = serviceFromLead(lead);

  if (Number(stepNumber || 0) <= 1) {
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
