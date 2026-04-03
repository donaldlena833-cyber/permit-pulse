import { sendAutomationEmail } from '../gmail.mjs';
import { eq, inList, order } from './supabase.mjs';

export const PROSPECT_CATEGORIES = [
  'interior_designer',
  'gc',
  'property_manager',
  'project_manager',
  'architect',
];

export const PROSPECT_STATUSES = ['new', 'drafted', 'sent', 'replied', 'archived'];

const CATEGORY_LABELS = {
  interior_designer: 'Interior Designer',
  gc: 'GC',
  property_manager: 'Property Manager',
  project_manager: 'Project Manager',
  architect: 'Architect',
};

const FIELD_ALIASES = {
  company_name: ['company', 'company_name', 'company name', 'firm', 'organization', 'organisation', 'studio', 'business'],
  contact_name: ['contact', 'contact_name', 'contact name', 'name', 'full_name', 'full name', 'person'],
  contact_role: ['role', 'title', 'position', 'job_title', 'job title'],
  email_address: ['email', 'email_address', 'email address', 'e-mail', 'work_email', 'work email'],
  phone: ['phone', 'phone_number', 'phone number', 'mobile', 'cell', 'telephone'],
  website: ['website', 'site', 'url', 'domain', 'company website'],
  category: ['category', 'lane', 'segment'],
  city: ['city', 'town'],
  state: ['state', 'province'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'desc'],
};

function chunk(items, size) {
  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function compactText(value) {
  const next = String(value || '').replace(/\s+/g, ' ').trim();
  return next || null;
}

function compactMultilineText(value) {
  const next = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return next || null;
}

function normalizeEmail(value) {
  const email = compactText(value)?.toLowerCase() || null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return digits || null;
}

function normalizeWebsite(value) {
  const cleaned = compactText(value);
  if (!cleaned) {
    return null;
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  if (/^[\w.-]+\.[a-z]{2,}/i.test(cleaned)) {
    return `https://${cleaned}`;
  }
  return cleaned;
}

function slugHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRow(row) {
  const entries = Object.entries(row || {});
  return Object.fromEntries(entries.map(([key, value]) => [slugHeader(key), value]));
}

function pickField(row, aliases) {
  for (const alias of aliases) {
    const match = row[slugHeader(alias)];
    const value = compactText(match);
    if (value) {
      return value;
    }
  }
  return null;
}

function greetingName(prospect) {
  const contact = compactText(prospect.contact_name);
  if (!contact) {
    return 'there';
  }

  return contact.split(/\s+/)[0] || 'there';
}

function categoryPitch(category) {
  if (category === 'architect') {
    return 'support architects with clean detailing, fabrication coordination, and sharp custom glass execution';
  }
  if (category === 'interior_designer') {
    return 'help interior designers turn glass concepts into finished installs without the usual back and forth';
  }
  if (category === 'property_manager') {
    return 'help property managers handle replacement, upgrades, and tenant improvement glass work quickly';
  }
  if (category === 'project_manager') {
    return 'help project managers keep glass scope moving with responsive field coordination and install support';
  }
  return 'support general contractors with measurements, pricing, fabrication, and installation for custom glass scope';
}

export function formatProspectCategory(category) {
  return CATEGORY_LABELS[category] || 'Prospect';
}

export function buildProspectDraft(prospect) {
  const subjectBase = compactText(prospect.company_name) || compactText(prospect.contact_name) || 'your team';

  return {
    subject: `MetroGlass Pro for ${subjectBase}`,
    body: [
      `Hi ${greetingName(prospect)},`,
      '',
      `I’m Donald from MetroGlass Pro. We ${categoryPitch(prospect.category)} across NYC, New Jersey, and Connecticut.`,
      '',
      'We handle custom showers, partitions, mirrors, railings, storefronts, and specialty glass installs. I attached our one-pager so you can get a quick feel for the kind of work we take on.',
      '',
      'If you have a project where glass scope still needs a responsive partner, I’d be happy to connect and put something together quickly.',
      '',
      'Best,',
      'Donald Lena',
      'MetroGlass Pro',
      '(332) 999-3846',
      'operations@metroglasspro.com',
    ].join('\n'),
  };
}

function mergeValue(nextValue, currentValue) {
  if (nextValue === undefined || nextValue === null || nextValue === '') {
    return currentValue ?? null;
  }
  return nextValue;
}

function normalizeProspectRow(row, category) {
  const normalized = normalizeRow(row);
  const emailAddress = normalizeEmail(pickField(normalized, FIELD_ALIASES.email_address));
  const rowCategory = compactText(pickField(normalized, FIELD_ALIASES.category));
  const nextCategory = PROSPECT_CATEGORIES.includes(rowCategory) ? rowCategory : category;

  if (!emailAddress) {
    return null;
  }

  return {
    category: nextCategory,
    company_name: compactText(pickField(normalized, FIELD_ALIASES.company_name)),
    contact_name: compactText(pickField(normalized, FIELD_ALIASES.contact_name)),
    contact_role: compactText(pickField(normalized, FIELD_ALIASES.contact_role)),
    email_address: emailAddress,
    email_normalized: emailAddress,
    phone: normalizePhone(pickField(normalized, FIELD_ALIASES.phone)),
    website: normalizeWebsite(pickField(normalized, FIELD_ALIASES.website)),
    city: compactText(pickField(normalized, FIELD_ALIASES.city)),
    state: compactText(pickField(normalized, FIELD_ALIASES.state)),
    notes: compactText(pickField(normalized, FIELD_ALIASES.notes)),
  };
}

function hydrateProspect(prospect) {
  if (!prospect) {
    return null;
  }

  const draft = buildProspectDraft(prospect);
  return {
    ...prospect,
    draft_subject: prospect.draft_subject || draft.subject,
    draft_body: prospect.draft_body || draft.body,
  };
}

async function insertMany(db, table, rows) {
  for (const group of chunk(rows, 100)) {
    if (!group.length) {
      continue;
    }
    await db.insert(table, group);
  }
}

export async function listProspects(db, options = {}) {
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
  const status = options.status || 'all';
  const category = options.category || 'all';

  const filters = [];
  if (status !== 'all') {
    filters.push(eq('status', status));
  }
  if (category !== 'all') {
    filters.push(eq('category', category));
  }

  const [prospects, allRows, recentImports] = await Promise.all([
    db.select('v2_prospects', {
      filters,
      ordering: [order('updated_at', 'desc')],
      limit,
      offset: (page - 1) * limit,
    }),
    db.select('v2_prospects', {
      columns: 'id,status,category',
      ordering: [order('updated_at', 'desc')],
    }),
    db.select('v2_prospect_import_batches', {
      ordering: [order('created_at', 'desc')],
      limit: 8,
    }),
  ]);

  const counts = {
    all: allRows.length,
    new: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    archived: 0,
  };

  const categories = Object.fromEntries(PROSPECT_CATEGORIES.map((value) => [value, 0]));

  for (const row of allRows) {
    if (counts[row.status] !== undefined) {
      counts[row.status] += 1;
    }
    if (categories[row.category] !== undefined) {
      categories[row.category] += 1;
    }
  }

  return {
    prospects: prospects.map(hydrateProspect),
    page,
    limit,
    counts,
    categories,
    recent_imports: recentImports,
  };
}

export async function getProspectDetail(db, prospectId) {
  const [prospect, timeline] = await Promise.all([
    db.single('v2_prospects', { filters: [eq('id', prospectId)] }),
    db.select('v2_prospect_events', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('created_at', 'desc')],
      limit: 50,
    }),
  ]);

  if (!prospect) {
    return null;
  }

  const hydrated = hydrateProspect(prospect);
  const importBatch = hydrated.import_batch_id
    ? await db.single('v2_prospect_import_batches', { filters: [eq('id', hydrated.import_batch_id)] })
    : null;

  return {
    prospect: hydrated,
    draft: {
      subject: hydrated.draft_subject,
      body: hydrated.draft_body,
    },
    timeline,
    import_batch: importBatch,
  };
}

export async function importProspects(db, payload, actorId = null) {
  const filename = compactText(payload?.filename) || 'upload.csv';
  const category = PROSPECT_CATEGORIES.includes(payload?.category) ? payload.category : null;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (!category) {
    throw new Error('Choose a valid prospect category before importing');
  }

  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  const batch = (await db.insert('v2_prospect_import_batches', {
    filename,
    category,
    row_count: rows.length,
    actor_id: actorId,
  }))[0];

  const normalizedRows = rows
    .map((row) => normalizeProspectRow(row, category))
    .filter(Boolean);

  const skipped = rows.length - normalizedRows.length;

  if (!normalizedRows.length) {
    await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
      imported_count: 0,
      skipped_count: skipped,
    });
    return {
      batch_id: batch.id,
      filename,
      category,
      imported: 0,
      skipped,
    };
  }

  const existing = await db.select('v2_prospects', {
    filters: [inList('email_normalized', normalizedRows.map((row) => row.email_normalized))],
  });

  const existingMap = Object.fromEntries(existing.map((row) => [row.email_normalized, row]));
  const now = new Date().toISOString();

  const prepared = normalizedRows.map((row) => {
    const current = existingMap[row.email_normalized] || null;
    const merged = {
      id: current?.id,
      category: row.category,
      company_name: mergeValue(row.company_name, current?.company_name),
      contact_name: mergeValue(row.contact_name, current?.contact_name),
      contact_role: mergeValue(row.contact_role, current?.contact_role),
      email_address: row.email_address,
      email_normalized: row.email_normalized,
      phone: mergeValue(row.phone, current?.phone),
      website: mergeValue(row.website, current?.website),
      city: mergeValue(row.city, current?.city),
      state: mergeValue(row.state, current?.state),
      source: 'csv_import',
      import_batch_id: batch.id,
      status: current?.status || 'new',
      notes: mergeValue(row.notes, current?.notes),
      gmail_thread_id: current?.gmail_thread_id || null,
      sent_count: Number(current?.sent_count || 0),
      last_sent_at: current?.last_sent_at || null,
      last_replied_at: current?.last_replied_at || null,
      created_at: current?.created_at || now,
      updated_at: now,
    };
    const draft = buildProspectDraft(merged);

    return {
      ...merged,
      draft_subject: current?.draft_subject || draft.subject,
      draft_body: current?.draft_body || draft.body,
    };
  });

  const imported = [];
  for (const group of chunk(prepared, 50)) {
    const rowsResult = await db.upsert('v2_prospects', group, 'email_normalized');
    imported.push(...rowsResult);
  }

  const events = imported.map((prospect) => ({
    prospect_id: prospect.id,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: existingMap[prospect.email_normalized] ? 'reimported' : 'imported',
    detail: {
      batch_id: batch.id,
      filename,
      category,
    },
  }));

  await insertMany(db, 'v2_prospect_events', events);
  await db.update('v2_prospect_import_batches', [eq('id', batch.id)], {
    imported_count: imported.length,
    skipped_count: skipped,
  });

  return {
    batch_id: batch.id,
    filename,
    category,
    imported: imported.length,
    skipped,
  };
}

export async function saveProspectDraft(db, prospectId, draft, actorId = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const nextSubject = compactText(draft?.subject) || buildProspectDraft(prospect).subject;
  const nextBody = compactMultilineText(draft?.body) || buildProspectDraft(prospect).body;
  const now = new Date().toISOString();

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    draft_subject: nextSubject,
    draft_body: nextBody,
    status: prospect.status === 'new' ? 'drafted' : prospect.status,
    updated_at: now,
  }))[0];

  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: 'draft_saved',
    detail: { subject: nextSubject },
  });

  return hydrateProspect(updated);
}

export async function saveProspectNotes(db, prospectId, notes, actorId = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    notes: compactMultilineText(notes),
    updated_at: new Date().toISOString(),
  }))[0];

  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: 'notes_updated',
    detail: null,
  });

  return hydrateProspect(updated);
}

export async function updateProspectStatus(db, prospectId, status, actorId = null) {
  if (!PROSPECT_STATUSES.includes(status)) {
    throw new Error('Invalid prospect status');
  }

  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = new Date().toISOString();
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    status,
    last_replied_at: status === 'replied' ? now : prospect.last_replied_at || null,
    updated_at: now,
  }))[0];

  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: 'status_changed',
    detail: { status },
  });

  return hydrateProspect(updated);
}

export async function sendProspect(env, db, prospectId, actorId = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const hydrated = hydrateProspect(prospect);
  const recipient = normalizeEmail(hydrated.email_address);

  if (!recipient) {
    throw new Error('Prospect does not have a valid email address');
  }

  const gmail = await sendAutomationEmail(env, {
    recipient,
    subject: hydrated.draft_subject,
    body: hydrated.draft_body,
    threadId: hydrated.gmail_thread_id || undefined,
  });

  const sentAt = new Date().toISOString();
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    draft_subject: hydrated.draft_subject,
    draft_body: hydrated.draft_body,
    status: 'sent',
    last_sent_at: sentAt,
    sent_count: Number(hydrated.sent_count || 0) + 1,
    gmail_thread_id: gmail.threadId || hydrated.gmail_thread_id || null,
    updated_at: sentAt,
  }))[0];

  await db.insert('v2_prospect_outcomes', {
    prospect_id: prospectId,
    email_address: recipient,
    outcome: 'sent',
    gmail_message_id: gmail.id || null,
    gmail_thread_id: gmail.threadId || null,
    detail: {
      subject: hydrated.draft_subject,
    },
    sent_at: sentAt,
  });

  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: 'operator',
    actor_id: actorId,
    event_type: 'sent',
    detail: {
      recipient,
      subject: hydrated.draft_subject,
    },
  });

  return {
    success: true,
    recipient,
    sentAt,
    prospect: hydrateProspect(updated),
  };
}
