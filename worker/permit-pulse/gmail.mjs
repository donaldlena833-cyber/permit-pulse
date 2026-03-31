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
  const bytes = new TextEncoder().encode(String(value));
  return encodeBase64Bytes(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeBase64Bytes(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function wrapBase64(base64, lineLength = 76) {
  const lines = [];

  for (let index = 0; index < base64.length; index += lineLength) {
    lines.push(base64.slice(index, index + lineLength));
  }

  return lines.join('\r\n');
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

async function loadDefaultAttachment(env) {
  if (!env.PERMIT_PULSE?.get) {
    return null;
  }

  const attachmentKey = env.OUTREACH_ATTACHMENT_KEY || 'default_outreach_attachment';
  const filename = env.OUTREACH_ATTACHMENT_NAME || '';

  if (!filename) {
    return null;
  }

  const payload = await env.PERMIT_PULSE.get(attachmentKey, 'arrayBuffer');
  if (!payload) {
    return null;
  }

  const bytes = new Uint8Array(payload);
  return {
    filename,
    contentType: env.OUTREACH_ATTACHMENT_CONTENT_TYPE || 'application/pdf',
    base64: wrapBase64(encodeBase64Bytes(bytes)),
  };
}

export async function getDefaultAttachmentStatus(env) {
  if (!env.PERMIT_PULSE?.get) {
    return {
      configured: false,
      loaded: false,
      filename: '',
    };
  }

  const attachmentKey = env.OUTREACH_ATTACHMENT_KEY || 'default_outreach_attachment';
  const filename = env.OUTREACH_ATTACHMENT_NAME || '';

  if (!filename) {
    return {
      configured: false,
      loaded: false,
      filename: '',
    };
  }

  const payload = await env.PERMIT_PULSE.get(attachmentKey, 'arrayBuffer');

  return {
    configured: true,
    loaded: Boolean(payload),
    filename,
  };
}

function buildRawMessage({ attachment, body, recipient, sender, subject }) {
  const displayName = 'Donald Lena';
  const htmlBody = textToHtml(body);

  if (!attachment) {
    return [
      `From: ${displayName} <${sender}>`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
    ].join('\r\n');
  }

  const mixedBoundary = `mixed_${crypto.randomUUID()}`;
  const altBoundary = `alt_${crypto.randomUUID()}`;

  return [
    `From: ${displayName} <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${altBoundary}--`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    attachment.base64,
    '',
    `--${mixedBoundary}--`,
  ].join('\r\n');
}

export function hasGmailAutomation(env) {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export async function sendAutomationEmail(env, draft) {
  const accessToken = await fetchAccessToken(env);
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const attachment = await loadDefaultAttachment(env);
  const rawMessage = buildRawMessage({
    attachment,
    body: draft.body,
    recipient: draft.recipient,
    sender,
    subject: draft.subject,
  });

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
