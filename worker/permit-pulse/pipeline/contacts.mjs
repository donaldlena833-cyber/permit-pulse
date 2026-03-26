import { scrapeWebsitePages } from '../lib/firecrawl.mjs';
import { appendLeadEvent } from '../lib/events.mjs';
import { getDomainFromEmail, getLocalPart, getBaseDomain, normalizePhone, normalizeText, titleCase } from '../lib/utils.mjs';
import { eq } from '../lib/supabase.mjs';
import { isBlockedEmail, isFreeMailbox } from '../lib/email.mjs';

const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SINGLE_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function checkPageStaleness(content) {
  let penalty = 0;
  const reasons = [];
  const match = String(content || '').match(/©\s*(20\d{2})|copyright\s*(20\d{2})/i);
  if (match) {
    const year = Number(match[1] || match[2]);
    const age = new Date().getFullYear() - year;
    if (age >= 4) {
      penalty = Math.min(age * 5, 30);
      reasons.push(`Copyright ${year}`);
    } else if (age >= 2) {
      penalty = age * 3;
      reasons.push(`Copyright ${year}`);
    }
  }

  const parked = ['this domain is for sale', 'under construction', 'coming soon', 'parked by', 'buy this domain', 'account suspended'];
  for (const phrase of parked) {
    if (String(content || '').toLowerCase().includes(phrase)) {
      penalty = 50;
      reasons.push(`Parked: "${phrase}"`);
      break;
    }
  }

  if (String(content || '').trim().length < 200) {
    penalty += 10;
    reasons.push('Thin content');
  }

  return { penalty, reasons, is_stale: penalty >= 30 };
}

function buildRawContext(content, email) {
  const index = content.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) {
    return '';
  }
  return content.slice(Math.max(0, index - 80), Math.min(content.length, index + email.length + 80)).trim();
}

function detectExtractionMethod(page, email) {
  const rawHtml = String(page?.html || '').toLowerCase();
  const text = String(page?.markdown || '').toLowerCase();
  return rawHtml.includes(`mailto:${email.toLowerCase()}`) || text.includes(`mailto:${email.toLowerCase()}`)
    ? 'mailto_link'
    : 'text_scrape';
}

function inferPersonContext(lead) {
  const personName = lead.applicant_name || lead.owner_name || '';
  const personRole = lead.applicant_name ? 'gc_applicant' : lead.owner_name ? 'owner' : 'unknown';
  return { personName, personRole };
}

function extractMailtoEmails(page) {
  return Array.from(String(page?.html || '').matchAll(/mailto:([^"'?#\s>]+)/gi))
    .map((match) => decodeURIComponent(String(match[1] || '')).trim().toLowerCase())
    .filter(Boolean);
}

function decodeCloudflareEmail(encoded) {
  const hex = String(encoded || '').replace(/[^a-f0-9]/gi, '');
  if (hex.length < 4 || hex.length % 2 !== 0) {
    return '';
  }

  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    let decoded = '';
    for (let index = 2; index < hex.length; index += 2) {
      decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
    }
    const email = decoded.trim().toLowerCase();
    return SINGLE_EMAIL_PATTERN.test(email) ? email : '';
  } catch {
    return '';
  }
}

function extractCloudflareProtectedEmails(page) {
  const html = String(page?.html || '');
  return [
    ...Array.from(html.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi)),
    ...Array.from(html.matchAll(/\/cdn-cgi\/l\/email-protection#([a-f0-9]+)/gi)),
  ]
    .map((match) => decodeCloudflareEmail(match[1]))
    .filter(Boolean);
}

function getPageSearchText(page) {
  return [
    String(page?.markdown || ''),
    String(page?.html || ''),
    String(page?.title || ''),
    String(page?.heading || ''),
  ].join('\n');
}

function isLikelyCompanyContact(lead, email, personFirstToken, companyFirstToken) {
  const domain = getDomainFromEmail(email);
  const localPart = getLocalPart(email);
  const officialDomain = lead.company_domain || getBaseDomain(lead.company_website || '');

  if (!officialDomain) {
    return true;
  }

  if (domain === officialDomain) {
    return true;
  }

  if (personFirstToken && localPart.includes(personFirstToken)) {
    return true;
  }

  if (companyFirstToken && (localPart.includes(companyFirstToken) || domain.includes(companyFirstToken))) {
    return true;
  }

  if (isFreeMailbox(domain) && (personFirstToken || companyFirstToken)) {
    return localPart.includes(personFirstToken) || localPart.includes(companyFirstToken);
  }

  return false;
}

function extractEmailsFromPage(lead, page, runId) {
  const searchText = getPageSearchText(page);
  const matches = [
    ...extractMailtoEmails(page),
    ...extractCloudflareProtectedEmails(page),
    ...(searchText.match(EMAIL_PATTERN) || []).map((value) => value.toLowerCase()),
  ];
  const stale = checkPageStaleness(searchText);
  const seen = new Set();
  const { personName, personRole } = inferPersonContext(lead);
  const personFirstToken = normalizeText(personName).split(/\s+/)[0] || '';
  const companyFirstToken = lead.company_name
    ? normalizeText(lead.company_name).split(/\s+/)[0]
    : '';

  return matches
    .filter((email) => {
      if (seen.has(email) || isBlockedEmail(email) || !isLikelyCompanyContact(lead, email, personFirstToken, companyFirstToken)) {
        return false;
      }
      seen.add(email);
      return true;
    })
    .map((email) => ({
      lead_id: lead.id,
      run_id: runId,
      email_address: email,
      domain: getDomainFromEmail(email),
      local_part: getLocalPart(email),
      person_name: personName ? titleCase(personName) : '',
      person_role: personRole,
      person_name_match: personFirstToken ? getLocalPart(email).includes(personFirstToken) : false,
      person_token_in_local: personFirstToken ? getLocalPart(email).includes(personFirstToken) : false,
      company_token_in_domain: companyFirstToken ? getDomainFromEmail(email).includes(companyFirstToken) : false,
      provenance_source: page.fetchSource || 'direct_fetch',
      provenance_url: page.url,
      provenance_page_type: page.pageType,
      provenance_extraction_method: detectExtractionMethod(page, email),
      provenance_page_title: page.title,
      provenance_page_heading: page.heading,
      provenance_raw_context: buildRawContext(searchText, email),
      provenance_crawl_ref: page.crawlRef || null,
      provenance_stale_penalty: stale.penalty,
      provenance_stale_reasons: stale.reasons,
    }));
}

function extractPhoneFromPages(pages) {
  for (const page of pages) {
    const match = page.markdown.match(PHONE_PATTERN);
    if (match?.[0]) {
      return normalizePhone(match[0]);
    }
  }
  return '';
}

function candidatePriority(candidate) {
  if (candidate.provenance_source === 'manual') {
    return 100;
  }
  if (candidate.provenance_page_type === 'contact' && candidate.provenance_extraction_method === 'mailto_link') {
    return 60;
  }
  if (candidate.provenance_page_type === 'contact') {
    return 50;
  }
  if (candidate.provenance_page_type === 'about' || candidate.provenance_page_type === 'team') {
    return 40;
  }
  if (candidate.provenance_page_type === 'footer') {
    return 30;
  }
  if (candidate.provenance_source === 'google_maps') {
    return 15;
  }
  return 10;
}

export async function discoverLeadContacts(env, db, runId, leadId) {
  const lead = await db.single('v2_leads', {
    filters: [eq('id', leadId)],
  });
  if (!lead) {
    return { candidateCount: 0, phone: '' };
  }

  await db.update('v2_email_candidates', [eq('lead_id', leadId), eq('is_current', true)], {
    is_current: false,
    superseded_at: new Date().toISOString(),
  });

  const pages = lead.company_website ? await scrapeWebsitePages(env, lead.company_website) : [];
  const emailRows = pages.flatMap((page) => extractEmailsFromPage(lead, page, runId));
  const deduped = [];
  const bestByEmail = new Map();

  for (const row of emailRows) {
    const current = bestByEmail.get(row.email_address);
    if (!current || candidatePriority(row) > candidatePriority(current)) {
      bestByEmail.set(row.email_address, row);
    }
  }

  for (const row of bestByEmail.values()) {
    deduped.push(row);
  }

  if (deduped.length > 0) {
    await db.insert('v2_email_candidates', deduped);
  }

  const phone = extractPhoneFromPages(pages) || lead.contact_phone || '';
  await db.update('v2_leads', [`id=eq.${lead.id}`], {
    contact_phone: phone,
    enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await appendLeadEvent(db, {
    lead_id: lead.id,
    run_id: runId,
    event_type: 'enrichment_completed',
    detail: {
      emails_found: deduped.length,
      phone,
      website: lead.company_website || '',
    },
  });

  return {
    candidateCount: deduped.length,
    phone,
    pageCount: pages.length,
    pages: pages.map((page) => ({
      url: page.url,
      pageType: page.pageType,
      hasEmailSignal: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(getPageSearchText(page)) || /mailto:/i.test(String(page.html || '')),
    })),
  };
}
