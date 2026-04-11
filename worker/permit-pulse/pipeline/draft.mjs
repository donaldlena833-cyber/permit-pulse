import { appendLeadEvent } from '../lib/events.mjs';
import { eq } from '../lib/supabase.mjs';
import { renderEmailTemplate, resolveTenantEmailTemplate } from '../lib/tenant-email-templates.mjs';

function serviceFromLead(lead) {
  const keyword = String(lead.relevance_keyword || '').toLowerCase();
  if (keyword.includes('shower') || keyword.includes('bath')) return 'shower enclosure';
  if (keyword.includes('mirror')) return 'mirror wall';
  if (keyword.includes('partition')) return 'glass partition';
  if (keyword.includes('railing')) return 'glass railing';
  return 'project scope';
}

function firstNameFromLead(lead) {
  return String(lead.contact_name || '').trim().split(/\s+/)[0] || 'there';
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
      sentence: 'Happy to do a quick takeoff from plans if you send them over.',
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
    sentence: `Would 10 minutes work this week to walk through the scope at ${lead.address || 'your project'}?`,
  };
}

function leadTemplateData(tenant, lead, context, ctaSentence) {
  return {
    first_name: firstNameFromLead(lead),
    company_name: lead.company_name || lead.applicant_name || lead.owner_name || 'your team',
    address: lead.address || 'your project',
    context,
    outreach_cta: ctaSentence,
  };
}

export async function buildInitialDraft(db, tenant, lead) {
  const cta = chooseDraftCta(lead);
  const template = await resolveTenantEmailTemplate(db, tenant, 'permit_initial');
  const rendered = renderEmailTemplate(tenant, template, leadTemplateData(tenant, lead, 'permit', cta.sentence));

  return {
    subject: rendered.subject,
    body: rendered.body,
    cta_type: cta.type,
  };
}

export async function buildFollowUpDraft(db, tenant, lead, stepNumber) {
  const templateKind = Number(stepNumber || 0) <= 1 ? 'permit_follow_up_1' : 'permit_follow_up_2';
  const cta = chooseDraftCta(lead);
  const template = await resolveTenantEmailTemplate(db, tenant, templateKind);
  const rendered = renderEmailTemplate(tenant, template, leadTemplateData(tenant, lead, 'permit', cta.sentence));

  return {
    subject: rendered.subject,
    body: rendered.body,
  };
}

export async function generateLeadDraft(db, tenant, runId, leadId) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });

  if (!lead || !lead.address) {
    return null;
  }

  const draft = await buildInitialDraft(db, tenant, lead);

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
