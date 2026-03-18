async function fetchAccessToken(env) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID || '',
      client_secret: env.GMAIL_CLIENT_SECRET || '',
      refresh_token: env.GMAIL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

function encodeBase64Url(value) {
  let encoded;

  if (typeof btoa === 'function') {
    encoded = btoa(value);
  } else {
    encoded = Buffer.from(value).toString('base64');
  }

  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 14px 0">${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function hasGmailAutomation(env) {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export async function sendAutomationEmail(env, draft) {
  const accessToken = await fetchAccessToken(env);
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const displayName = 'Donald Lena';
  const rawMessage = [
    `From: ${displayName} <${sender}>`,
    `To: ${draft.recipient}`,
    `Subject: ${draft.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    textToHtml(draft.body),
  ].join('\r\n');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeBase64Url(rawMessage),
      threadId: draft.threadId || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gmail send failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
