import { normalizeWhitespace, titleCase, toAbsoluteUrl, uniq } from './utils.mjs';

const EMAIL_SIGNAL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|mailto:/i;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return normalizeWhitespace(match?.[1] || '');
}

function extractHeading(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return normalizeWhitespace((match?.[1] || '').replace(/<[^>]+>/g, ' '));
}

function stripHtml(html) {
  return normalizeWhitespace(
    String(html || '')
      .replace(/mailto:([^"'?#\s>]+)/gi, ' $1 ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Website fetch failed: ${response.status} ${url}`);
  }

  const html = await response.text();
  return {
    url: response.url || url,
    title: extractTitle(html),
    heading: extractHeading(html),
    html,
    markdown: stripHtml(html),
  };
}

function hasUsefulEmailContent(page) {
  return EMAIL_SIGNAL.test(`${String(page?.markdown || '')}\n${String(page?.html || '')}`);
}

function shouldFallbackToHtml(page) {
  const markdown = String(page?.markdown || '');
  return !hasUsefulEmailContent(page) || markdown.length < 240;
}

async function fetchViaFirecrawl(env, url) {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const data = payload?.data || {};
  return {
    url: data.metadata?.sourceURL || url,
    title: normalizeWhitespace(data.metadata?.title || ''),
    heading: normalizeWhitespace(data.metadata?.ogTitle || data.metadata?.title || ''),
    html: data.html || '',
    markdown: normalizeWhitespace(data.markdown || stripHtml(data.html || '')),
    crawlRef: payload?.id || null,
  };
}

export function getWebsiteCandidatePages(website) {
  const direct = String(website || '').trim();
  const homepage = toAbsoluteUrl(website, '/');
  return uniq([
    direct,
    homepage,
    toAbsoluteUrl(website, '/contact'),
    toAbsoluteUrl(website, '/contact-us'),
    toAbsoluteUrl(website, '/get-in-touch'),
    toAbsoluteUrl(website, '/about'),
    toAbsoluteUrl(website, '/about-us'),
    toAbsoluteUrl(website, '/team'),
    toAbsoluteUrl(website, '/our-team'),
    toAbsoluteUrl(website, '/staff'),
  ]);
}

export function detectPageType(url, title = '', heading = '') {
  const fingerprint = `${url} ${title} ${heading}`.toLowerCase();

  if (fingerprint.includes('/contact') || fingerprint.includes('contact')) return 'contact';
  if (fingerprint.includes('/about') || fingerprint.includes('about us')) return 'about';
  if (fingerprint.includes('/team') || fingerprint.includes('/staff') || fingerprint.includes('our team')) return 'team';
  if (fingerprint.includes('footer')) return 'footer';
  if (fingerprint.includes('/blog')) return 'blog';
  return 'other';
}

export async function scrapeWebsitePages(env, website) {
  const urls = getWebsiteCandidatePages(website);
  const pages = [];

  for (const url of urls) {
    try {
      let page = env.FIRECRAWL_API_KEY ? await fetchViaFirecrawl(env, url) : await fetchHtml(url);
      if (env.FIRECRAWL_API_KEY && shouldFallbackToHtml(page)) {
        try {
          const htmlPage = await fetchHtml(url);
          if (hasUsefulEmailContent(htmlPage) || String(htmlPage.markdown || '').length > String(page.markdown || '').length) {
            page = {
              ...htmlPage,
              crawlRef: page.crawlRef || null,
            };
          }
        } catch {
          // Keep Firecrawl result when raw HTML fallback fails.
        }
      }
      pages.push({
        ...page,
        pageType: detectPageType(page.url, page.title, page.heading),
      });
    } catch {
      continue;
    }
  }

  return pages.map((page) => ({
    ...page,
    pageType: page.pageType || 'other',
    title: page.title || titleCase(page.pageType || 'other'),
  }));
}
