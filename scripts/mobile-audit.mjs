import { chromium, devices } from 'playwright';

const baseUrl = process.env.MGLEADS_URL || 'https://leads.metroglasspro.com';
const email = process.env.MGLEADS_EMAIL || 'operations@metroglasspro.com';
const password = process.env.MGLEADS_PASSWORD;

if (!password) {
  console.error('Set MGLEADS_PASSWORD before running the mobile audit.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices['iPhone 13'],
});
const page = await context.newPage();

async function snap(name) {
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await snap('01-login');

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await snap('02-login-filled');

  const submit = page.getByRole('button', { name: /open dashboard|sign in|log in|continue/i }).first();
  await submit.click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await snap('03-post-login');

  const opportunitiesTab = page.getByRole('button', { name: /opportunities/i }).first();
  if (await opportunitiesTab.count()) {
    await opportunitiesTab.click().catch(() => {});
    await page.waitForTimeout(1500);
    await snap('04-opportunities');
  }

  const addressButtons = page
    .locator('button')
    .filter({ hasText: /\d{1,4}.*(Street|Avenue|Ave|Road|Rd|Blvd|Drive|Dr|Place|Pl|Lane|Ln|Court|Ct|Way)/i });
  if ((await addressButtons.count()) > 0) {
    await addressButtons.first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await snap('05-lead-open');
  }

  console.log(JSON.stringify({
    url: page.url(),
    title: await page.title(),
    bodyText: (await page.locator('body').innerText()).slice(0, 4000),
  }, null, 2));
} finally {
  await browser.close();
}
