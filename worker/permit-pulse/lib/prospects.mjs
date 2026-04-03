import { sendAutomationEmail } from '../gmail.mjs';
import { getAppConfig } from './config.mjs';
import { formatPriorOutreachMessage, getPriorOutreach } from './outreach-guard.mjs';
import { eq, inList, order } from './supabase.mjs';
import {
  addDaysToDateKey,
  formatLocalDateKey,
  zonedDateTimeToUtcIso,
} from './timezone.mjs';
import { nowIso } from './utils.mjs';

export const PROSPECT_CATEGORIES = [
  'interior_designer',
  'gc',
  'property_manager',
  'project_manager',
  'architect',
];

export const PROSPECT_STATUSES = ['new', 'drafted', 'sent', 'replied', 'opted_out', 'archived'];

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

function categoryCounter(initialValue = 0) {
  return Object.fromEntries(PROSPECT_CATEGORIES.map((category) => [category, initialValue]));
}

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
    return 'support architects with clean detailing, responsive coordination, and high-end glass execution';
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

function topicLine(prospect) {
  if (prospect.category === 'architect') {
    return 'architectural teams';
  }
  if (prospect.category === 'interior_designer') {
    return 'design-driven residential teams';
  }
  if (prospect.category === 'property_manager') {
    return 'property teams';
  }
  if (prospect.category === 'project_manager') {
    return 'project teams';
  }
  return 'construction teams';
}

function isProspectSuppressed(prospect) {
  return Boolean(prospect?.do_not_contact || prospect?.status === 'opted_out' || prospect?.opted_out_at);
}

function deriveQueueState(prospect, followUps = []) {
  if (!prospect) {
    return 'queued_initial';
  }

  if (prospect.status === 'opted_out' || prospect.do_not_contact || prospect.opted_out_at) {
    return 'opted_out';
  }
  if (prospect.status === 'archived') {
    return 'archived';
  }
  if (prospect.status === 'replied') {
    return 'replied';
  }

  const pendingFollowUp = followUps.find((followUp) => followUp.status === 'pending');
  const sentFollowUp = followUps.find((followUp) => followUp.status === 'sent');

  if (!prospect.first_sent_at) {
    return 'queued_initial';
  }
  if (pendingFollowUp) {
    return 'queued_follow_up';
  }
  if (sentFollowUp || prospect.last_follow_up_at) {
    return 'follow_up_sent';
  }
  return 'sent';
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

function findProspectFollowUps(followUps, prospectId) {
  return (followUps || []).filter((row) => String(row.prospect_id) === String(prospectId));
}

function hydrateProspect(prospect, options = {}) {
  if (!prospect) {
    return null;
  }

  const followUps = Array.isArray(options.followUps) ? options.followUps : [];
  const draft = buildProspectDraft(prospect);
  return {
    ...prospect,
    draft_subject: prospect.draft_subject || draft.subject,
    draft_body: prospect.draft_body || draft.body,
    queue_state: deriveQueueState(prospect, followUps),
    next_follow_up: followUps.find((followUp) => followUp.status === 'pending') || null,
    automation_block_reason: isProspectSuppressed(prospect) ? 'opted_out' : null,
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

async function listAllProspects(db) {
  return db.select('v2_prospects', {
    ordering: [order('created_at', 'asc')],
  });
}

async function listAllProspectFollowUps(db) {
  try {
    return await db.select('v2_prospect_follow_ups', {
      ordering: [order('scheduled_at', 'asc')],
    });
  } catch (error) {
    return [];
  }
}

async function listRecentProspectOutcomes(db) {
  try {
    return await db.select('v2_prospect_outcomes', {
      ordering: [order('created_at', 'desc')],
      limit: 400,
    });
  } catch (error) {
    return [];
  }
}

async function listRecentProspectEvents(db) {
  try {
    return await db.select('v2_prospect_events', {
      ordering: [order('created_at', 'desc')],
      limit: 100,
    });
  } catch (error) {
    return [];
  }
}

function matchesLocalDate(value, dateKey, timeZone) {
  if (!value) {
    return false;
  }
  return formatLocalDateKey(new Date(value), timeZone) === dateKey;
}

function detailKind(row) {
  const kind = row?.detail?.kind;
  return kind === 'follow_up' ? 'follow_up' : kind === 'initial' ? 'initial' : null;
}

function summaryLabel(prospect) {
  return prospect.contact_name || prospect.company_name || prospect.email_address;
}

function baseFollowUpDraft(prospect) {
  return {
    subject: `Quick follow-up from MetroGlass Pro`,
    body: [
      `Hi ${greetingName(prospect)},`,
      '',
      `Following up on my note from MetroGlass Pro. We ${categoryPitch(prospect.category)} and keep glass scope moving cleanly for ${topicLine(prospect)}.`,
      '',
      'If there is any shower, partition, mirror, railing, storefront, or custom glass work coming up, I would be happy to connect.',
      '',
      'Best,',
      'Donald Lena',
      'MetroGlass Pro',
      '(332) 999-3846',
      'operations@metroglasspro.com',
      'metroglasspro.com',
    ].join('\n'),
  };
}

async function ensureProspectFollowUp(db, prospect, config) {
  const existing = await db.select('v2_prospect_follow_ups', {
    filters: [eq('prospect_id', prospect.id)],
    ordering: [order('step_number', 'asc')],
    limit: 5,
  }).catch(() => []);

  if (existing.some((row) => Number(row.step_number || 0) === 1)) {
    return existing.find((row) => Number(row.step_number || 0) === 1) || null;
  }

  const dateKey = formatLocalDateKey(new Date(prospect.first_sent_at || prospect.last_sent_at || nowIso()), config.prospect_timezone);
  const scheduledDateKey = addDaysToDateKey(dateKey, Number(config.prospect_follow_up_delay_days || 3));
  const scheduledAt = zonedDateTimeToUtcIso(
    scheduledDateKey,
    config.prospect_follow_up_send_time || '23:30',
    config.prospect_timezone || 'America/New_York',
  );
  const draft = buildProspectFollowUpDraft(prospect);

  const [row] = await db.insert('v2_prospect_follow_ups', {
    prospect_id: prospect.id,
    step_number: 1,
    scheduled_at: scheduledAt,
    draft_subject: draft.subject,
    draft_body: draft.body,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return row || null;
}

async function cancelProspectFollowUps(db, prospectId, reason = 'status_changed') {
  return db.update('v2_prospect_follow_ups', [eq('prospect_id', prospectId), eq('status', 'pending')], {
    status: 'cancelled',
    updated_at: nowIso(),
    slot_key: reason,
  }).catch(() => []);
}

async function recordProspectEvent(db, prospectId, eventType, actorType = 'system', actorId = null, detail = null) {
  await db.insert('v2_prospect_events', {
    prospect_id: prospectId,
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    detail,
    created_at: nowIso(),
  });
}

async function recordProspectOutcome(db, payload) {
  await db.insert('v2_prospect_outcomes', {
    created_at: nowIso(),
    ...payload,
  });
}

async function getProspectWithFollowUps(db, prospectId) {
  const [prospect, followUps] = await Promise.all([
    db.single('v2_prospects', { filters: [eq('id', prospectId)] }),
    db.select('v2_prospect_follow_ups', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('step_number', 'asc')],
    }).catch(() => []),
  ]);

  if (!prospect) {
    return { prospect: null, followUps: [] };
  }

  return { prospect, followUps };
}

async function sendProspectMessage(env, db, prospectId, options = {}) {
  const { prospect, followUps } = await getProspectWithFollowUps(db, prospectId);
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const kind = options.kind === 'follow_up' ? 'follow_up' : 'initial';
  const hydrated = hydrateProspect(prospect, { followUps });
  const recipient = normalizeEmail(hydrated.email_address);

  if (!recipient) {
    throw new Error('Prospect does not have a valid email address');
  }

  if (isProspectSuppressed(hydrated)) {
    throw new Error('Prospect is suppressed and cannot receive automation');
  }

  if (kind === 'initial' && hydrated.first_sent_at) {
    throw new Error('Initial outreach already sent for this prospect');
  }

  if (kind === 'initial') {
    const priorOutreach = await getPriorOutreach(db, recipient);
    const sameProspect = priorOutreach?.prospect_id && String(priorOutreach.prospect_id) === String(prospectId);
    if (priorOutreach && !sameProspect) {
      await db.update('v2_prospects', [eq('id', prospectId)], {
        status: 'archived',
        updated_at: nowIso(),
      });
      await recordProspectOutcome(db, {
        prospect_id: prospectId,
        email_address: recipient,
        outcome: 'archived',
        detail: {
          reason: 'duplicate_initial_suppressed',
          prior_outcome: priorOutreach.outcome || null,
          prior_sent_at: priorOutreach.sent_at || priorOutreach.created_at || null,
          source_table: priorOutreach.source_table || null,
          kind: 'initial',
        },
      });
      await recordProspectEvent(db, prospectId, 'duplicate_initial_suppressed', options.actorType || 'system', options.actorId || null, {
        recipient,
        source_table: priorOutreach.source_table || null,
      });
      throw new Error(`${formatPriorOutreachMessage(priorOutreach)}. Prospect archived to prevent duplicate initial outreach.`);
    }
  }

  const followUpDraft = kind === 'follow_up' ? buildProspectFollowUpDraft(hydrated) : null;
  const draftSubject = compactText(options.subject) || (kind === 'follow_up' ? followUpDraft?.subject : hydrated.draft_subject) || '';
  const draftBody = compactMultilineText(options.body) || (kind === 'follow_up' ? followUpDraft?.body : hydrated.draft_body) || '';

  const gmail = await sendAutomationEmail(env, {
    recipient,
    subject: draftSubject,
    body: draftBody,
    threadId: kind === 'follow_up' ? hydrated.gmail_thread_id || undefined : undefined,
  });

  const sentAt = nowIso();
  const nextPatch = {
    draft_subject: kind === 'initial' ? draftSubject : hydrated.draft_subject,
    draft_body: kind === 'initial' ? draftBody : hydrated.draft_body,
    status: 'sent',
    first_sent_at: kind === 'initial' ? (hydrated.first_sent_at || sentAt) : hydrated.first_sent_at,
    last_sent_at: sentAt,
    last_follow_up_at: kind === 'follow_up' ? sentAt : hydrated.last_follow_up_at || null,
    sent_count: Number(hydrated.sent_count || 0) + 1,
    gmail_thread_id: gmail.threadId || hydrated.gmail_thread_id || null,
    updated_at: sentAt,
  };

  const [updated] = await db.update('v2_prospects', [eq('id', prospectId)], nextPatch);

  await recordProspectOutcome(db, {
    prospect_id: prospectId,
    email_address: recipient,
    outcome: 'sent',
    gmail_message_id: gmail.id || null,
    gmail_thread_id: gmail.threadId || hydrated.gmail_thread_id || null,
    detail: {
      kind,
      step_number: kind === 'follow_up' ? Number(options.stepNumber || 1) : 0,
      subject: draftSubject,
      automated: Boolean(options.automated),
      slot_key: options.slotKey || null,
    },
    sent_at: sentAt,
  });

  await recordProspectEvent(
    db,
    prospectId,
    kind === 'follow_up' ? 'follow_up_sent' : 'sent',
    options.actorType || 'system',
    options.actorId || null,
    {
      recipient,
      subject: draftSubject,
      slot_key: options.slotKey || null,
    },
  );

  if (kind === 'initial') {
    await ensureProspectFollowUp(db, {
      ...updated,
      first_sent_at: nextPatch.first_sent_at,
      last_sent_at: nextPatch.last_sent_at,
    }, options.config || await getAppConfig(db));
  }

  if (kind === 'follow_up' && options.followUpId) {
    await db.update('v2_prospect_follow_ups', [eq('id', options.followUpId)], {
      status: 'sent',
      sent_at: sentAt,
      slot_key: options.slotKey || null,
      draft_subject: draftSubject,
      draft_body: draftBody,
      updated_at: sentAt,
    });
  }

  return {
    success: true,
    recipient,
    sentAt,
    kind,
    prospect: hydrateProspect(updated, {
      followUps: kind === 'follow_up'
        ? followUps.map((row) => (String(row.id) === String(options.followUpId) ? { ...row, status: 'sent', sent_at: sentAt } : row))
        : followUps,
    }),
  };
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
      'metroglasspro.com',
    ].join('\n'),
  };
}

export function buildProspectFollowUpDraft(prospect) {
  return baseFollowUpDraft(prospect);
}

function hydrateFollowUpItem(followUp, prospect) {
  return {
    ...followUp,
    category: prospect?.category || null,
    contact_name: prospect?.contact_name || null,
    company_name: prospect?.company_name || null,
    email_address: prospect?.email_address || null,
    queue_state: prospect ? deriveQueueState(prospect, [followUp]) : 'queued_follow_up',
  };
}

export async function getProspectAutomationOverview(db, config = null) {
  const resolvedConfig = config || await getAppConfig(db);
  const timeZone = resolvedConfig.prospect_timezone || 'America/New_York';
  const todayKey = formatLocalDateKey(new Date(), timeZone);
  const [prospects, followUps, outcomes, events] = await Promise.all([
    listAllProspects(db),
    listAllProspectFollowUps(db),
    listRecentProspectOutcomes(db),
    listRecentProspectEvents(db),
  ]);

  const prospectMap = Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect]));
  const followUpsByProspect = Object.fromEntries(
    prospects.map((prospect) => [prospect.id, findProspectFollowUps(followUps, prospect.id)]),
  );
  const initialSentToday = categoryCounter(0);
  const followUpSentToday = categoryCounter(0);
  const initialQueueByCategory = categoryCounter(0);
  const followUpDueByCategory = categoryCounter(0);
  const optOutsByCategory = categoryCounter(0);

  for (const prospect of prospects) {
    if (prospect.status === 'opted_out' || prospect.do_not_contact || prospect.opted_out_at) {
      optOutsByCategory[prospect.category] += 1;
    }
  }

  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, timeZone)) {
      continue;
    }
    const prospect = prospectMap[outcome.prospect_id];
    if (!prospect || !PROSPECT_CATEGORIES.includes(prospect.category)) {
      continue;
    }
    if (detailKind(outcome) === 'follow_up') {
      followUpSentToday[prospect.category] += 1;
    } else {
      initialSentToday[prospect.category] += 1;
    }
  }

  const initialQueue = [];
  const followUpQueue = [];

  for (const prospect of prospects) {
    const prospectFollowUps = followUpsByProspect[prospect.id] || [];

    if (!prospect.first_sent_at && !isProspectSuppressed(prospect) && ['new', 'drafted'].includes(prospect.status)) {
      initialQueueByCategory[prospect.category] += 1;
      initialQueue.push(hydrateProspect(prospect, { followUps: prospectFollowUps }));
    }

    for (const followUp of prospectFollowUps) {
      if (followUp.status === 'pending') {
        followUpDueByCategory[prospect.category] += 1;
        followUpQueue.push(hydrateFollowUpItem(followUp, hydrateProspect(prospect, { followUps: prospectFollowUps })));
      }
    }
  }

  const recentSends = outcomes
    .filter((outcome) => outcome.outcome === 'sent')
    .slice(0, 12)
    .map((outcome) => {
      const prospect = prospectMap[outcome.prospect_id];
      return {
        id: outcome.id,
        prospect_id: outcome.prospect_id,
        category: prospect?.category || null,
        contact_name: summaryLabel(prospect || { contact_name: null, company_name: null, email_address: outcome.email_address }),
        email_address: outcome.email_address,
        sent_at: outcome.sent_at || outcome.created_at,
        kind: detailKind(outcome) || 'initial',
      };
    });

  const exceptions = events
    .filter((event) => ['duplicate_initial_suppressed', 'opted_out', 'status_changed'].includes(event.event_type))
    .slice(0, 12)
    .map((event) => {
      const prospect = prospectMap[event.prospect_id];
      return {
        id: event.id,
        prospect_id: event.prospect_id,
        label: summaryLabel(prospect || { contact_name: null, company_name: null, email_address: 'Prospect' }),
        category: prospect?.category || null,
        event_type: event.event_type,
        created_at: event.created_at,
      };
    });

  return {
    pilot_enabled: Boolean(resolvedConfig.prospect_pilot_enabled),
    permit_auto_send_enabled: Boolean(resolvedConfig.permit_auto_send_enabled),
    timezone: timeZone,
    initial_send_time: resolvedConfig.prospect_initial_send_time || '11:00',
    follow_up_send_time: resolvedConfig.prospect_follow_up_send_time || '23:30',
    initial_daily_per_category: Number(resolvedConfig.prospect_initial_daily_per_category || 10),
    follow_up_daily_per_category: Number(resolvedConfig.prospect_follow_up_daily_per_category || 10),
    follow_up_delay_days: Number(resolvedConfig.prospect_follow_up_delay_days || 3),
    initial_sent_today: initialSentToday,
    follow_up_sent_today: followUpSentToday,
    initial_queue_by_category: initialQueueByCategory,
    follow_up_due_by_category: followUpDueByCategory,
    opted_out_by_category: optOutsByCategory,
    initial_queue: initialQueue.slice(0, 20),
    follow_up_queue: followUpQueue.slice(0, 20),
    recent_sends: recentSends,
    exceptions,
  };
}

export async function listProspects(db, options = {}) {
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
  const status = options.status || 'all';
  const category = options.category || 'all';

  const config = await getAppConfig(db);
  const [allRows, recentImports, followUps, automation] = await Promise.all([
    listAllProspects(db),
    db.select('v2_prospect_import_batches', {
      ordering: [order('created_at', 'desc')],
      limit: 8,
    }),
    listAllProspectFollowUps(db),
    getProspectAutomationOverview(db, config),
  ]);

  const counts = {
    all: allRows.length,
    new: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
    opted_out: 0,
    archived: 0,
  };
  const categories = categoryCounter(0);
  const followUpsByProspect = Object.fromEntries(
    allRows.map((prospect) => [prospect.id, findProspectFollowUps(followUps, prospect.id)]),
  );

  for (const row of allRows) {
    if (counts[row.status] !== undefined) {
      counts[row.status] += 1;
    }
    if (categories[row.category] !== undefined) {
      categories[row.category] += 1;
    }
  }

  const filtered = allRows.filter((prospect) => {
    if (status !== 'all' && prospect.status !== status) {
      return false;
    }
    if (category !== 'all' && prospect.category !== category) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered]
    .sort((left, right) => Number(new Date(right.updated_at || 0).getTime()) - Number(new Date(left.updated_at || 0).getTime()))
    .slice((page - 1) * limit, page * limit)
    .map((prospect) => hydrateProspect(prospect, { followUps: followUpsByProspect[prospect.id] || [] }));

  return {
    prospects: sorted,
    page,
    limit,
    counts,
    categories,
    recent_imports: recentImports,
    follow_up_queue: automation.follow_up_queue,
    initial_queue: automation.initial_queue,
    automation,
  };
}

export async function getProspectDetail(db, prospectId) {
  const [prospect, timeline, followUps] = await Promise.all([
    db.single('v2_prospects', { filters: [eq('id', prospectId)] }),
    db.select('v2_prospect_events', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('created_at', 'desc')],
      limit: 50,
    }),
    db.select('v2_prospect_follow_ups', {
      filters: [eq('prospect_id', prospectId)],
      ordering: [order('step_number', 'asc')],
    }).catch(() => []),
  ]);

  if (!prospect) {
    return null;
  }

  const hydrated = hydrateProspect(prospect, { followUps });
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
    follow_ups: followUps.map((followUp) => hydrateFollowUpItem(followUp, hydrated)),
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
  const now = nowIso();

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
      do_not_contact: Boolean(current?.do_not_contact || false),
      opted_out_at: current?.opted_out_at || null,
      first_sent_at: current?.first_sent_at || null,
      last_sent_at: current?.last_sent_at || null,
      last_follow_up_at: current?.last_follow_up_at || null,
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
    created_at: nowIso(),
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
  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    draft_subject: nextSubject,
    draft_body: nextBody,
    status: prospect.status === 'new' ? 'drafted' : prospect.status,
    updated_at: nowIso(),
  }))[0];

  await recordProspectEvent(db, prospectId, 'draft_saved', 'operator', actorId, { subject: nextSubject });

  return hydrateProspect(updated, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function saveProspectNotes(db, prospectId, notes, actorId = null) {
  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], {
    notes: compactMultilineText(notes),
    updated_at: nowIso(),
  }))[0];

  await recordProspectEvent(db, prospectId, 'notes_updated', 'operator', actorId, null);

  return hydrateProspect(updated, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function updateProspectStatus(db, prospectId, status, actorId = null) {
  if (!PROSPECT_STATUSES.includes(status)) {
    throw new Error('Invalid prospect status');
  }

  const prospect = await db.single('v2_prospects', { filters: [eq('id', prospectId)] });
  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = nowIso();
  const patch = {
    status,
    do_not_contact: status === 'opted_out' ? true : Boolean(prospect.do_not_contact),
    opted_out_at: status === 'opted_out' ? now : prospect.opted_out_at || null,
    last_replied_at: status === 'replied' ? now : prospect.last_replied_at || null,
    updated_at: now,
  };

  const updated = (await db.update('v2_prospects', [eq('id', prospectId)], patch))[0];
  if (status === 'replied' || status === 'opted_out' || status === 'archived') {
    await cancelProspectFollowUps(db, prospectId, status);
  }

  if (status === 'opted_out') {
    await recordProspectOutcome(db, {
      prospect_id: prospectId,
      email_address: prospect.email_address,
      outcome: 'archived',
      detail: { kind: 'opted_out' },
    });
  }

  await recordProspectEvent(db, prospectId, status === 'opted_out' ? 'opted_out' : 'status_changed', 'operator', actorId, { status });

  return hydrateProspect(updated, {
    followUps: await db.select('v2_prospect_follow_ups', { filters: [eq('prospect_id', prospectId)] }).catch(() => []),
  });
}

export async function optOutProspect(db, prospectId, actorId = null) {
  return updateProspectStatus(db, prospectId, 'opted_out', actorId);
}

export async function sendProspect(env, db, prospectId, actorId = null) {
  const { prospect, followUps } = await getProspectWithFollowUps(db, prospectId);
  const kind = prospect?.first_sent_at ? 'follow_up' : 'initial';
  const pendingFollowUp = followUps.find((row) => row.status === 'pending') || null;

  return sendProspectMessage(env, db, prospectId, {
    kind,
    actorId,
    actorType: 'operator',
    followUpId: kind === 'follow_up' ? pendingFollowUp?.id || null : null,
    stepNumber: kind === 'follow_up' ? Number(pendingFollowUp?.step_number || 1) : 0,
    config: await getAppConfig(db),
  });
}

function byCreatedAtAsc(left, right) {
  return Number(new Date(left?.created_at || 0).getTime()) - Number(new Date(right?.created_at || 0).getTime());
}

function byScheduledAtAsc(left, right) {
  return Number(new Date(left?.scheduled_at || 0).getTime()) - Number(new Date(right?.scheduled_at || 0).getTime());
}

async function findSlotDuplicateRun(db, mode, slotKey) {
  const recentRuns = await db.select('v2_automation_runs', {
    ordering: [order('created_at', 'desc')],
    limit: 40,
  });

  return recentRuns.find((run) => {
    const scope = run?.source_scope && typeof run.source_scope === 'object' && !Array.isArray(run.source_scope)
      ? run.source_scope
      : {};
    return scope.mode === mode && scope.slot_key === slotKey && ['running', 'completed'].includes(run.status);
  }) || null;
}

function canQueueInitialProspect(prospect) {
  return prospect && !prospect.first_sent_at && !isProspectSuppressed(prospect) && ['new', 'drafted'].includes(prospect.status);
}

export async function runProspectInitialBatch(env, db, config, slotKey) {
  const prospects = await listAllProspects(db);
  const attemptedByCategory = categoryCounter(0);
  const sentByCategory = categoryCounter(0);
  const skippedByCategory = categoryCounter(0);
  const todayKey = formatLocalDateKey(new Date(), config.prospect_timezone);
  const outcomes = await listRecentProspectOutcomes(db);
  const sentTodayByCategory = categoryCounter(0);

  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent' || detailKind(outcome) === 'follow_up' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, config.prospect_timezone)) {
      continue;
    }
    const prospect = prospects.find((row) => String(row.id) === String(outcome.prospect_id));
    if (prospect && sentTodayByCategory[prospect.category] !== undefined) {
      sentTodayByCategory[prospect.category] += 1;
    }
  }

  const queued = prospects.filter(canQueueInitialProspect).sort(byCreatedAtAsc);
  const selected = [];
  for (const category of PROSPECT_CATEGORIES) {
    const remaining = Math.max(Number(config.prospect_initial_daily_per_category || 10) - Number(sentTodayByCategory[category] || 0), 0);
    if (remaining <= 0) {
      continue;
    }
    selected.push(...queued.filter((prospect) => prospect.category === category).slice(0, remaining));
  }

  for (const prospect of selected) {
    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'initial',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        config,
      });
      sentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'initial_send_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Initial automation skipped'),
      });
    }
  }

  return {
    attempted_by_category: attemptedByCategory,
    sent_by_category: sentByCategory,
    skipped_by_category: skippedByCategory,
    selected_count: selected.length,
  };
}

export async function runProspectFollowUpBatch(env, db, config, slotKey) {
  const [followUps, prospects, outcomes] = await Promise.all([
    listAllProspectFollowUps(db),
    listAllProspects(db),
    listRecentProspectOutcomes(db),
  ]);

  const prospectMap = Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect]));
  const attemptedByCategory = categoryCounter(0);
  const sentByCategory = categoryCounter(0);
  const skippedByCategory = categoryCounter(0);
  const todayKey = formatLocalDateKey(new Date(), config.prospect_timezone);
  const sentTodayByCategory = categoryCounter(0);

  for (const outcome of outcomes) {
    if (outcome.outcome !== 'sent' || detailKind(outcome) !== 'follow_up' || !matchesLocalDate(outcome.sent_at || outcome.created_at, todayKey, config.prospect_timezone)) {
      continue;
    }
    const prospect = prospectMap[outcome.prospect_id];
    if (prospect && sentTodayByCategory[prospect.category] !== undefined) {
      sentTodayByCategory[prospect.category] += 1;
    }
  }

  const due = followUps
    .filter((followUp) => followUp.status === 'pending' && new Date(followUp.scheduled_at).getTime() <= Date.now())
    .sort(byScheduledAtAsc);

  const selected = [];
  for (const category of PROSPECT_CATEGORIES) {
    const remaining = Math.max(Number(config.prospect_follow_up_daily_per_category || 10) - Number(sentTodayByCategory[category] || 0), 0);
    if (remaining <= 0) {
      continue;
    }
    selected.push(...due.filter((followUp) => prospectMap[followUp.prospect_id]?.category === category).slice(0, remaining));
  }

  for (const followUp of selected) {
    const prospect = prospectMap[followUp.prospect_id];
    if (!prospect) {
      continue;
    }

    attemptedByCategory[prospect.category] += 1;
    try {
      await sendProspectMessage(env, db, prospect.id, {
        kind: 'follow_up',
        automated: true,
        actorType: 'schedule',
        actorId: null,
        slotKey,
        stepNumber: Number(followUp.step_number || 1),
        followUpId: followUp.id,
        subject: followUp.draft_subject,
        body: followUp.draft_body,
        config,
      });
      sentByCategory[prospect.category] += 1;
    } catch (error) {
      skippedByCategory[prospect.category] += 1;
      await recordProspectEvent(db, prospect.id, 'follow_up_skipped', 'schedule', null, {
        slot_key: slotKey,
        error: error instanceof Error ? error.message : String(error || 'Follow-up automation skipped'),
      });
    }
  }

  return {
    attempted_by_category: attemptedByCategory,
    sent_by_category: sentByCategory,
    skipped_by_category: skippedByCategory,
    selected_count: selected.length,
  };
}

export async function runScheduledProspectPilot(env, db, createRun, completeRun, failRun, options = {}) {
  const config = await getAppConfig(db);
  if (!config.prospect_pilot_enabled) {
    return { started: false, reason: 'prospect_pilot_disabled' };
  }

  const mode = options.mode === 'prospect_follow_up_send' ? 'prospect_follow_up_send' : 'prospect_initial_send';
  const slotKey = options.slotKey;
  const existingRun = slotKey ? await findSlotDuplicateRun(db, mode, slotKey) : null;
  if (existingRun) {
    return { started: false, reason: 'slot_already_processed', run: existingRun };
  }

  const run = await createRun(
    db,
    'schedule',
    null,
    config,
    {
      mode,
      slot_key: slotKey,
      time_zone: config.prospect_timezone,
      progress: {
        backlog_pending: 0,
        claimed: 0,
        processed: 0,
        fresh_inserted: 0,
        remaining: 0,
      },
    },
    { initialStage: mode === 'prospect_initial_send' ? 'prospect_initial_queue' : 'prospect_follow_up_queue' },
  );

  try {
    const summary = mode === 'prospect_initial_send'
      ? await runProspectInitialBatch(env, db, config, slotKey)
      : await runProspectFollowUpBatch(env, db, config, slotKey);

    await completeRun(db, run.id, {
      sends_attempted: Object.values(summary.attempted_by_category).reduce((total, value) => total + Number(value || 0), 0),
      sends_succeeded: Object.values(summary.sent_by_category).reduce((total, value) => total + Number(value || 0), 0),
      sends_failed: Object.values(summary.skipped_by_category).reduce((total, value) => total + Number(value || 0), 0),
    }, {
      source_scope: {
        mode,
        slot_key: slotKey,
        per_category: summary,
      },
    });

    return {
      started: true,
      run,
      summary,
    };
  } catch (error) {
    await failRun(db, run.id, error, {}, {
      source_scope: {
        mode,
        slot_key: slotKey,
      },
    });
    throw error;
  }
}
