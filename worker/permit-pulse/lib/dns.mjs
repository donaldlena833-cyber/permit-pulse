import { createSupabaseClient, eq } from './supabase.mjs';
import { getBaseDomain, nowIso } from './utils.mjs';

const PARKED_SIGNALS = [
  'this domain is for sale',
  'under construction',
  'coming soon',
  'parked by',
  'buy this domain',
  'account suspended',
  'website expired',
];

async function fetchDnsJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`DNS lookup failed: ${response.status}`);
  }
  return response.json();
}

async function lookupMx(domain) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
  const payload = await fetchDnsJson(url, {
    headers: { Accept: 'application/dns-json' },
  });
  const answers = Array.isArray(payload?.Answer) ? payload.Answer : [];
  return {
    hasMx: answers.length > 0,
    mxRecords: answers,
  };
}

async function checkWebsite(domain) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`https://${domain}`, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PermitPulse/2.0',
      },
    });
    const text = await response.text();
    const lowered = text.toLowerCase();
    const isParked = PARKED_SIGNALS.some((signal) => lowered.includes(signal));
    return {
      hasWebsite: response.ok,
      isParked,
    };
  } catch {
    return {
      hasWebsite: false,
      isParked: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDomainHealth(env, domain) {
  const normalizedDomain = getBaseDomain(domain);
  if (!normalizedDomain) {
    return null;
  }

  const db = createSupabaseClient(env);
  const existing = await db.single('v2_domain_health', {
    filters: [eq('domain', normalizedDomain)],
  });

  const now = Date.now();
  if (existing?.expires_at && new Date(existing.expires_at).getTime() > now) {
    return existing;
  }

  const mxResult = await lookupMx(normalizedDomain);
  const websiteResult = await checkWebsite(normalizedDomain);

  let healthScore = 0;
  if (mxResult.hasMx && websiteResult.hasWebsite && !websiteResult.isParked) {
    healthScore = 100;
  } else if (mxResult.hasMx && !websiteResult.isParked) {
    healthScore = websiteResult.hasWebsite ? 100 : 50;
  } else if (mxResult.hasMx && websiteResult.isParked) {
    healthScore = 20;
  }

  const payload = {
    domain: normalizedDomain,
    has_mx: mxResult.hasMx,
    has_website: websiteResult.hasWebsite,
    is_parked: websiteResult.isParked,
    mx_records: mxResult.mxRecords,
    health_score: healthScore,
    checked_at: nowIso(),
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  };

  const [row] = await db.upsert('v2_domain_health', payload, 'domain');
  return row || payload;
}
