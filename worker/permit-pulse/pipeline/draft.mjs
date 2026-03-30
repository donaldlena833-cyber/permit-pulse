import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';

function truncateText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function greetingName(lead) {
  const first = String(lead.contact_name || '').trim().split(/\s+/)[0];
  return first || 'team';
}

function cleanDescription(lead) {
  return truncateText(lead.work_description || lead.description || 'renovation scope', 120).replace(/[.]+$/g, '');
}

function cleanAddress(lead) {
  const raw = String(lead.address || '').trim();
  if (!raw) {
    return 'the property';
  }

  return toTitleCase(raw)
    .replace(/\bNy\b/g, 'NY')
    .replace(/\bNj\b/g, 'NJ')
    .replace(/\bCt\b/g, 'CT');
}

function workType(lead) {
  const rawType = String(lead.permit_type || '').trim();
  if (rawType && rawType.toLowerCase() !== 'general construction') {
    return rawType;
  }

  const keyword = String(lead.relevance_keyword || '').trim();
  if (keyword) {
    return keyword
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return rawType || 'General Construction';
}

function buildShortHook(lead) {
  const workTypeWords = String(workType(lead) || 'renovation')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const descriptionWords = String(lead.work_description || lead.description || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  const hook = [...workTypeWords, ...descriptionWords]
    .slice(0, 8)
    .join(' ')
    .trim();

  return hook || 'renovation';
}

function signatureLines(includePhone = true) {
  const lines = [
    'Best,',
    'Donald Lena',
    'MetroGlass Pro',
  ];

  if (includePhone) {
    lines.push('(332) 999-3846');
  }

  return lines;
}

export function chooseDraftCta() {
  return {
    type: 'visualize_render',
    sentence: 'Happy to pull field measurements and send tailored render options the same day.',
  }
}

export function buildInitialDraft(lead) {
  const address = cleanAddress(lead);
  const subject = `3D render for glass on ${address}?`;
  const body = [
    `Hi ${greetingName(lead)},`,
    '',
    `Saw the DOB filing for ${address} ${buildShortHook(lead)}.`,
    '',
    'We’re MetroGlass Pro, Manhattan licensed & insured specialists in precision indoor residential glass: frameless showers, partitions, mirrors, and cabinets.',
    '',
    'What sets us apart: we generate rapid 3D renders before any glass is cut so you and the client can see the final look instantly.',
    '',
    'If any glass scope is still open I can pull measurements and send you 2-3 render options same day, no cost, no pressure.',
    '',
    'Would a 15-minute call this week work?',
    '',
    'Best,',
    'Donald Lena',
    'MetroGlass Pro',
    '(332) 999-3846',
  ].join('\n');

  return {
    subject,
    body,
    cta_type: 'visualize_render',
  };
}

export function buildFollowUpDraft(lead, stepNumber) {
  const address = cleanAddress(lead);
  const greeting = `Hi ${greetingName(lead)},`;
  const projectLine = `Just following up on my note about the ${address} filing - ${workType(lead)} / ${cleanDescription(lead)}.`;

  if (stepNumber === 2) {
    return {
      subject: `Quick follow-up on glass for ${address}?`,
      body: [
        greeting,
        projectLine,
        'Still happy to pull field measurements and send you 2-3 3D render options same day so you and the client can visualize the frameless shower / partition / mirror exactly how it will look.',
        'No cost, no pressure, takes us ~5 minutes.',
        "Any upcoming projects you'd like me to quote on?",
        ...signatureLines(true),
      ].join('\n\n'),
    };
  }

  if (stepNumber === 3) {
    return {
      subject: `One more note on ${address} glass scope?`,
      body: [
        greeting,
        `Last quick note on the ${address} job.`,
        'We specialize in precision indoor residential glass (frameless showers, partitions, mirrors, cabinets) and our Visualize renders have helped architects close clients faster on similar Manhattan bathroom/kitchen renos.',
        'If glass is still in play, I can get you render options today.',
        'Open to a quick call or just reply with "yes" and I will schedule the measure.',
        'Thanks,',
        'Donald Lena',
        'MetroGlass Pro',
        '(332) 999-3846',
      ].join('\n\n'),
    };
  }

  return {
    subject: `${address} glass - still open?`,
    body: [
      greeting,
      `Last follow-up on the ${address} filing.`,
      'If any glass scope is still open, reply with "yes" and I will send render options today.',
      'Otherwise, no worries, best of luck with the project.',
      ...signatureLines(false),
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
