import { eq, order } from './supabase.mjs';
import { normalizeTenantFeatures, tenantBusinessName, tenantWebsite } from './tenants.mjs';

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  '{{first_name}}',
  '{{company_name}}',
  '{{sender_name}}',
  '{{sender_phone}}',
  '{{business_name}}',
  '{{website}}',
  '{{category_pitch}}',
  '{{category_focus}}',
  '{{outreach_cta}}',
  '{{address}}',
];

export const EMAIL_TEMPLATE_KINDS = [
  'prospect_initial',
  'prospect_follow_up_1',
  'prospect_follow_up_2',
  'permit_initial',
  'permit_follow_up_1',
  'permit_follow_up_2',
];

function compactText(value) {
  const next = String(value || '').replace(/\r/g, '').trim();
  return next || null;
}

function interpolateValue(value, replacements) {
  return String(value || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key) => replacements[key] ?? '');
}

function fallbackPitch(tenant) {
  return normalizeTenantFeatures(tenant).permit_scanning
    ? 'handle custom glass installations including shower enclosures, mirrors, partitions, cabinet glass, and railings'
    : 'handle kitchen renovations, bathroom remodels, flooring, and finish carpentry';
}

function fallbackFocus(tenant) {
  return normalizeTenantFeatures(tenant).permit_scanning
    ? 'We support architects, designers, contractors, and property teams with clean fabrication, fast field coordination, and reliable closeout on glass scope.'
    : 'We help architects, designers, contractors, and property teams move remodeling scope with disciplined scheduling, field execution, and finish quality.';
}

function fallbackOutreachCta(tenant, context = 'prospect') {
  if (context === 'permit') {
    return normalizeTenantFeatures(tenant).permit_scanning
      ? 'If the glass scope is still being lined up, I would be happy to review plans, turn around pricing quickly, and help keep the project moving.'
      : 'If the remodeling scope is still being lined up, I would be happy to review plans, turn around pricing quickly, and help keep the project moving.';
  }

  return normalizeTenantFeatures(tenant).permit_scanning
    ? 'If there is any upcoming glass scope, I would be glad to connect, turn around pricing quickly, and help keep things moving.'
    : 'If there is any upcoming remodeling scope, I would be glad to connect, turn around pricing quickly, and help keep things moving.';
}

function replacementTokens(tenant, data = {}) {
  const categoryLabel = String(data.category || '').replace(/_/g, ' ');
  const dynamicReplacements = {
    category: categoryLabel,
    category_label: categoryLabel,
    business_name: tenantBusinessName(tenant),
    sender_name: compactText(data.sender_name) || compactText(tenant?.sender_name) || 'Team',
    sender_phone: compactText(data.sender_phone) || compactText(tenant?.phone) || '',
    website: compactText(data.website) || tenantWebsite(tenant) || '',
  };

  const categoryPitch = compactText(data.category_pitch)
    || compactText(interpolateValue(tenant?.outreach_pitch || '', dynamicReplacements))
    || fallbackPitch(tenant);
  const categoryFocus = compactText(data.category_focus)
    || compactText(interpolateValue(tenant?.outreach_focus || '', dynamicReplacements))
    || fallbackFocus(tenant);
  const outreachCta = compactText(data.outreach_cta)
    || compactText(interpolateValue(tenant?.outreach_cta || '', dynamicReplacements))
    || fallbackOutreachCta(tenant, data.context || 'prospect');

  return {
    first_name: compactText(data.first_name) || 'there',
    company_name: compactText(data.company_name) || compactText(data.companyName) || 'your team',
    sender_name: dynamicReplacements.sender_name,
    sender_phone: dynamicReplacements.sender_phone,
    business_name: dynamicReplacements.business_name,
    website: dynamicReplacements.website,
    category_pitch: categoryPitch,
    category_focus: categoryFocus,
    outreach_cta: outreachCta,
    address: compactText(data.address) || 'your project',
  };
}

const DEFAULT_TEMPLATES = {
  prospect_initial: {
    subject_template: '{{company_name}} | {{business_name}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      "I'm {{sender_name}} from {{business_name}}, and I'm reaching out because {{company_name}} looks closely aligned with the kind of work we support.",
      '',
      'We {{category_pitch}}.',
      '',
      '{{category_focus}}',
      '',
      'I attached our About Us one-pager so you can get a quick feel for the work, responsiveness, and detail we bring to projects.',
      '',
      '{{outreach_cta}}',
      '',
      'Warm regards,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
  prospect_follow_up_1: {
    subject_template: 'Quick follow-up for {{company_name}} | {{business_name}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      'Following up on my note from {{business_name}}.',
      '',
      'We {{category_pitch}}, and {{category_focus}}',
      '',
      'If there is any upcoming scope, I would be glad to send over our About Us one-pager again and map out quick next steps.',
      '',
      '{{outreach_cta}}',
      '',
      'Warm regards,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
  prospect_follow_up_2: {
    subject_template: 'Final follow-up for {{company_name}} | {{business_name}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      'One last note from {{business_name}}.',
      '',
      'We {{category_pitch}}, and {{category_focus}}',
      '',
      'If there is any upcoming scope, I would still be glad to share our About Us one-pager and connect on quick next steps.',
      '',
      '{{outreach_cta}}',
      '',
      'Warm regards,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
  permit_initial: {
    subject_template: 'Quick note on {{address}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      'I saw the filing for {{address}} and wanted to reach out.',
      '',
      "I'm with {{business_name}}. We {{category_pitch}}.",
      '',
      '{{category_focus}}',
      '',
      '{{outreach_cta}}',
      '',
      'Best,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
  permit_follow_up_1: {
    subject_template: 'Following up on {{address}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      'Wanted to follow up on my note about {{address}}.',
      '',
      'We {{category_pitch}}, and {{category_focus}}',
      '',
      '{{outreach_cta}}',
      '',
      'Best,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
  permit_follow_up_2: {
    subject_template: 'Final follow up for {{address}}',
    body_template: [
      'Hi {{first_name}},',
      '',
      'Just wanted to make sure this did not get buried.',
      '',
      'We {{category_pitch}}, and {{category_focus}}',
      '',
      '{{outreach_cta}}',
      '',
      'Best,',
      '{{sender_name}}',
      '{{business_name}}',
      '{{sender_phone}}',
      '{{website}}',
    ].join('\n'),
  },
};

export function buildDefaultEmailTemplate(tenant, templateKind) {
  const fallback = DEFAULT_TEMPLATES[templateKind];
  if (!fallback) {
    throw new Error(`Unsupported template kind: ${templateKind}`);
  }

  return {
    template_kind: templateKind,
    category: null,
    subject_template: fallback.subject_template,
    body_template: fallback.body_template,
    is_active: true,
    defaults: true,
  };
}

export async function listTenantEmailTemplates(db, tenant) {
  const rows = await db.select('v2_tenant_email_templates', {
    ordering: [order('template_kind', 'asc'), order('updated_at', 'asc')],
  }).catch(() => []);

  const byKind = new Map(rows.map((row) => [`${row.template_kind}:${row.category || '__all__'}`, row]));
  const missing = EMAIL_TEMPLATE_KINDS
    .filter((kind) => !byKind.has(`${kind}:__all__`))
    .map((kind) => ({
      tenant_id: tenant.id,
      ...buildDefaultEmailTemplate(tenant, kind),
      updated_at: new Date().toISOString(),
    }));

  if (missing.length > 0) {
    await db.insert('v2_tenant_email_templates', missing).catch(() => null);
    return db.select('v2_tenant_email_templates', {
      ordering: [order('template_kind', 'asc'), order('updated_at', 'asc')],
    }).catch(() => []);
  }

  return rows;
}

function selectTemplate(rows, templateKind, category = null) {
  return rows.find((row) => row.template_kind === templateKind && String(row.category || '') === String(category || ''))
    || rows.find((row) => row.template_kind === templateKind && !row.category)
    || null;
}

export async function resolveTenantEmailTemplate(db, tenant, templateKind, options = {}) {
  const templates = options.templates || await listTenantEmailTemplates(db, tenant);
  return selectTemplate(templates, templateKind, options.category) || buildDefaultEmailTemplate(tenant, templateKind);
}

export function renderEmailTemplate(tenant, template, data = {}) {
  const replacements = replacementTokens(tenant, data);

  return {
    subject: interpolateValue(template.subject_template, replacements).trim(),
    body: interpolateValue(template.body_template, replacements).trim(),
    replacements,
  };
}

export function sampleTemplateData(tenant, templateKind, category = null, overrides = {}) {
  return {
    first_name: 'Taylor',
    company_name: category ? `${String(category).replace(/_/g, ' ')} Studio` : 'Northline Projects',
    address: '123 Mercer Street, New York, NY',
    category,
    context: templateKind.startsWith('permit_') ? 'permit' : 'prospect',
    ...overrides,
  };
}

export async function previewTenantEmailTemplate(db, tenant, payload = {}) {
  const template = payload.id
    ? await db.single('v2_tenant_email_templates', { filters: [eq('id', payload.id)] })
    : payload.template_kind
      ? buildDefaultEmailTemplate(tenant, payload.template_kind)
      : null;

  if (!template) {
    throw new Error('Template not found');
  }

  const hydratedTemplate = {
    ...template,
    subject_template: compactText(payload.subject_template) || template.subject_template,
    body_template: compactText(payload.body_template) || template.body_template,
  };
  const sample = sampleTemplateData(
    tenant,
    hydratedTemplate.template_kind,
    hydratedTemplate.category,
    payload.sample_data || {},
  );

  return {
    template: hydratedTemplate,
    preview: renderEmailTemplate(tenant, hydratedTemplate, sample),
    sample_data: sample,
  };
}
