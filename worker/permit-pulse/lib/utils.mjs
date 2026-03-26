export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function cleanCompanyName(value) {
  return normalizeWhitespace(String(value || '').replace(/\s+(llc|inc|corp|co|pllc|pc|ltd)\.?$/i, ''));
}

export function safeJsonParse(value, fallback = null) {
  if (!value || typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function slugifyToken(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

export function getDomainFromEmail(email) {
  const parts = String(email || '').toLowerCase().split('@');
  return parts.length === 2 ? parts[1].trim() : '';
}

export function getLocalPart(email) {
  const parts = String(email || '').toLowerCase().split('@');
  return parts.length === 2 ? parts[0].trim() : '';
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function escapeLike(value) {
  return encodeURIComponent(String(value || ''));
}

export function titleCase(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inferEmailPattern(email, personName = '') {
  const local = getLocalPart(email);
  const [first = '', last = ''] = normalizeText(personName).split(/\s+/);

  if (first && last && local === `${first}.${last}`) {
    return 'first.last';
  }
  if (first && last && local === `${first}${last}`) {
    return 'firstlast';
  }
  if (first && last && local === `${first[0]}${last}`) {
    return 'flast';
  }
  if (first && local === first) {
    return 'first';
  }

  return 'unknown';
}

export function pickFirst(...values) {
  return values.find((value) => Boolean(String(value || '').trim())) || '';
}

export function daysAgo(dateLike) {
  if (!dateLike) {
    return Number.POSITIVE_INFINITY;
  }

  const value = new Date(dateLike).getTime();
  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - value) / 86400000;
}

export function daysSince(dateLike) {
  return daysAgo(dateLike);
}

export function buildPermitKey(source, permitNumber) {
  return `${normalizeText(source || 'unknown')}::${normalizeWhitespace(permitNumber || '')}`;
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(value || '').trim();
}

export function getBaseDomain(urlOrDomain) {
  if (!urlOrDomain) {
    return '';
  }

  try {
    const url = String(urlOrDomain).includes('://') ? new URL(urlOrDomain) : new URL(`https://${urlOrDomain}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(urlOrDomain).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

export function toAbsoluteUrl(base, nextPath = '/') {
  try {
    return new URL(nextPath, base).toString();
  } catch {
    return '';
  }
}

export function sortByDateDesc(items, key) {
  return [...items].sort((left, right) => {
    const leftValue = new Date(left?.[key] || 0).getTime();
    const rightValue = new Date(right?.[key] || 0).getTime();
    return rightValue - leftValue;
  });
}
