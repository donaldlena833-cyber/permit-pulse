import { maybeDecryptText } from './lib/crypto.mjs';

async function fetchAccessToken(env, refreshToken = '') {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID || '',
      client_secret: env.GMAIL_CLIENT_SECRET || '',
      refresh_token: refreshToken || env.GMAIL_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function resolveMailboxRefreshToken(env, mailbox = null) {
  if (!mailbox) {
    return env.GMAIL_REFRESH_TOKEN || '';
  }

  if (mailbox.refresh_token) {
    return mailbox.refresh_token;
  }

  return (await maybeDecryptText(env, mailbox.encrypted_refresh_token)) || '';
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

function normalizeDraftText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function hasMeaningfulDraftText(value) {
  return normalizeDraftText(value).trim().length > 0;
}

function sanitizeHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function needsEncodedHeader(value) {
  return /[^\x20-\x7E]/.test(value);
}

function encodeMimeWord(value) {
  const bytes = new TextEncoder().encode(sanitizeHeaderValue(value));
  return `=?UTF-8?B?${encodeBase64Bytes(bytes)}?=`;
}

function encodeHeaderValue(value) {
  const sanitized = sanitizeHeaderValue(value);
  if (!sanitized) {
    return '';
  }
  return needsEncodedHeader(sanitized) ? encodeMimeWord(sanitized) : sanitized;
}

function encodeBodyPart(value) {
  const bytes = new TextEncoder().encode(normalizeDraftText(value));
  return wrapBase64(encodeBase64Bytes(bytes));
}

function keepMimeLine(value) {
  return value !== null && value !== undefined;
}

function formatMailbox(displayName, email) {
  const safeEmail = sanitizeHeaderValue(email);
  const safeName = sanitizeHeaderValue(displayName);
  if (!safeName || safeName === safeEmail) {
    return safeEmail;
  }
  return `${encodeHeaderValue(safeName)} <${safeEmail}>`;
}

function resolveAttachmentConfig(env, options = {}) {
  return {
    attachmentKey: options.attachmentKey || env.OUTREACH_ATTACHMENT_KEY || 'default_outreach_attachment',
    filename: options.attachmentFilename || env.OUTREACH_ATTACHMENT_NAME || '',
    contentType: options.attachmentContentType || env.OUTREACH_ATTACHMENT_CONTENT_TYPE || 'application/pdf',
  };
}

async function loadAttachment(env, options = {}) {
  if (!env.PERMIT_PULSE?.get) {
    return null;
  }

  const { attachmentKey, filename, contentType } = resolveAttachmentConfig(env, options);

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
    contentType,
    base64: wrapBase64(encodeBase64Bytes(bytes)),
  };
}

export async function getAttachmentStatus(env, options = {}) {
  if (!env.PERMIT_PULSE?.get) {
    return {
      configured: false,
      loaded: false,
      filename: '',
    };
  }

  const { attachmentKey, filename } = resolveAttachmentConfig(env, options);

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

function buildRawMessage({ attachment, body, recipient, replyTo, sender, senderName, subject }) {
  const altBoundary = `alt_${crypto.randomUUID()}`;
  const fromHeader = formatMailbox(senderName || sender, sender);
  const toHeader = sanitizeHeaderValue(recipient);
  const subjectHeader = encodeHeaderValue(subject);
  const replyToHeader = replyTo ? `Reply-To: ${formatMailbox(replyTo, replyTo)}` : null;
  const plainBody = normalizeDraftText(body);
  const htmlBody = textToHtml(plainBody);
  const alternativeBody = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBodyPart(plainBody),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBodyPart(htmlBody),
    '',
    `--${altBoundary}--`,
  ];

  if (!attachment) {
    return [
      `From: ${fromHeader}`,
      replyToHeader,
      `To: ${toHeader}`,
      `Subject: ${subjectHeader}`,
      'MIME-Version: 1.0',
      ...alternativeBody,
    ].filter(keepMimeLine).join('\r\n');
  }

  const mixedBoundary = `mixed_${crypto.randomUUID()}`;

  return [
    `From: ${fromHeader}`,
    replyToHeader,
    `To: ${toHeader}`,
    `Subject: ${subjectHeader}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    ...alternativeBody,
    '',
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    attachment.base64,
    '',
    `--${mixedBoundary}--`,
  ].filter(keepMimeLine).join('\r\n');
}

export function hasGmailAutomation(env) {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET);
}

export async function sendAutomationEmail(env, draft) {
  const refreshToken = await resolveMailboxRefreshToken(env, draft.mailbox || null);
  if (!refreshToken) {
    throw new Error('Connect a workspace Gmail mailbox before sending email');
  }

  const accessToken = await fetchAccessToken(env, refreshToken);
  const sender = draft.mailbox?.email || draft.sender || env.GMAIL_SENDER || 'info@yourcompany.com';
  const replyTo = draft.replyTo || null;
  const subject = normalizeDraftText(draft.subject).trim();
  const body = normalizeDraftText(draft.body);

  if (!subject || !hasMeaningfulDraftText(body)) {
    throw new Error('Refusing to send blank email draft');
  }

  const attachment = await loadAttachment(env, {
    attachmentKey: draft.attachmentKey,
    attachmentFilename: draft.attachmentFilename,
    attachmentContentType: draft.attachmentContentType,
  });
  const rawMessage = buildRawMessage({
    attachment,
    body,
    recipient: draft.recipient,
    replyTo,
    sender,
    senderName: draft.senderName || sender,
    subject,
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

async function gmailRequest(env, path, init = {}, mailbox = null) {
  const refreshToken = await resolveMailboxRefreshToken(env, mailbox);
  if (!refreshToken) {
    throw new Error('Connect a workspace Gmail mailbox before syncing replies');
  }

  const accessToken = await fetchAccessToken(env, refreshToken);
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

  const payload = await gmailRequest(env, `messages?${params.toString()}`, {}, env.__mailbox || null);
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

async function getMessageMetadata(env, messageId) {
  const params = new URLSearchParams();
  params.set('format', 'metadata');
  for (const header of ['From', 'Subject', 'Date', 'To']) {
    params.append('metadataHeaders', header);
  }

  const payload = await gmailRequest(env, `messages/${encodeURIComponent(messageId)}?${params.toString()}`, {}, env.__mailbox || null);
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
  const payload = await gmailRequest(env, `messages/${encodeURIComponent(messageId)}?format=full`, {}, env.__mailbox || null);
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
  const sender = options.mailbox?.email || env.GMAIL_SENDER || 'info@yourcompany.com';
  const newerThanDays = Math.max(1, Number(options.newerThanDays || 30));
  const maxResults = Math.min(Math.max(Number(options.maxResults || 0), 1), 100);
  const query = options.query || `in:inbox newer_than:${newerThanDays}d -from:${sender} -from:me`;
  const scopedEnv = { ...env, __mailbox: options.mailbox || null };
  const messageRefs = await listMessageIds(scopedEnv, query, maxResults);
  const messages = [];

  for (const message of messageRefs) {
    const metadata = options.includeBody
      ? await getMessageContent(scopedEnv, message.id)
      : await getMessageMetadata(scopedEnv, message.id);
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
