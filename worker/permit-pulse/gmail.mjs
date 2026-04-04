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

function gmailHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
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

function parseHeader(headers = [], name) {
  return headers.find((header) => String(header.name || '').toLowerCase() === String(name || '').toLowerCase())?.value || null;
}

function parseEmailAddress(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = `${normalized}${padding}`;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  return decodeURIComponent(escape(atob(base64)));
}

function extractMessageText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const next = extractMessageText(part);
      if (next) {
        return next;
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

async function gmailRequest(env, path, init = {}) {
  const accessToken = await fetchAccessToken(env);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      ...gmailHeaders(accessToken),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function listMessageIds(env, query, maxResults = 50) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('includeSpamTrash', 'false');
  params.set('maxResults', String(Math.min(Math.max(Number(maxResults || 0), 1), 100)));

  const payload = await gmailRequest(env, `messages?${params.toString()}`);
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

async function getMessageMetadata(env, messageId) {
  const params = new URLSearchParams();
  params.set('format', 'metadata');
  for (const header of ['From', 'Subject', 'Date', 'To']) {
    params.append('metadataHeaders', header);
  }

  const payload = await gmailRequest(env, `messages/${encodeURIComponent(messageId)}?${params.toString()}`);
  const headers = payload?.payload?.headers || [];

  return {
    id: payload?.id || messageId,
    threadId: payload?.threadId || null,
    snippet: payload?.snippet || '',
    internalDate: payload?.internalDate ? new Date(Number(payload.internalDate)).toISOString() : null,
    from: parseHeader(headers, 'From'),
    fromEmail: parseEmailAddress(parseHeader(headers, 'From')),
    to: parseHeader(headers, 'To'),
    subject: parseHeader(headers, 'Subject'),
    date: parseHeader(headers, 'Date'),
  };
}

async function getMessageContent(env, messageId) {
  const payload = await gmailRequest(env, `messages/${encodeURIComponent(messageId)}?format=full`);
  const headers = payload?.payload?.headers || [];

  return {
    id: payload?.id || messageId,
    threadId: payload?.threadId || null,
    snippet: payload?.snippet || '',
    internalDate: payload?.internalDate ? new Date(Number(payload.internalDate)).toISOString() : null,
    from: parseHeader(headers, 'From'),
    fromEmail: parseEmailAddress(parseHeader(headers, 'From')),
    to: parseHeader(headers, 'To'),
    subject: parseHeader(headers, 'Subject'),
    date: parseHeader(headers, 'Date'),
    bodyText: extractMessageText(payload?.payload),
  };
}

export async function listRecentInboxMessages(env, options = {}) {
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const newerThanDays = Math.max(1, Number(options.newerThanDays || 30));
  const maxResults = Math.min(Math.max(Number(options.maxResults || 0), 1), 100);
  const query = options.query || `in:inbox newer_than:${newerThanDays}d -from:${sender} -from:me`;
  const messageRefs = await listMessageIds(env, query, maxResults);
  const messages = [];

  for (const message of messageRefs) {
    const metadata = options.includeBody
      ? await getMessageContent(env, message.id)
      : await getMessageMetadata(env, message.id);
    if (!metadata.fromEmail) {
      continue;
    }
    messages.push(metadata);
  }

  return messages;
}

export async function listRecentInboxReplies(env, options = {}) {
  return listRecentInboxMessages(env, options);
}
