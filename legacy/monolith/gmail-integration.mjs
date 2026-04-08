/**
 * PermitPulse — Gmail Integration Module
 * 
 * Sends approved outreach emails from operations@metroglasspro.com
 * using Google Workspace service account with domain-wide delegation.
 * 
 * SETUP:
 * 1. Google Cloud Console → Create project → Enable Gmail API
 * 2. Create Service Account → Download JSON key
 * 3. Google Workspace Admin → Security → API Controls → Domain-wide delegation
 *    Add the service account client_id with scope: https://www.googleapis.com/auth/gmail.send
 * 4. Store the JSON key as a Cloudflare Worker secret: GOOGLE_SERVICE_ACCOUNT
 * 
 * ENV VARS:
 * - GOOGLE_SERVICE_ACCOUNT — JSON key string for the service account
 * - GMAIL_SENDER — email to send from (default: operations@metroglasspro.com)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JWT / OAUTH2 — Service Account Auth for Cloudflare Workers
// No external dependencies, uses Web Crypto API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function base64UrlEncode(data) {
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data);
  }
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function str2ab(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) bufView[i] = str.charCodeAt(i);
  return buf;
}

async function getGoogleAccessToken(serviceAccountJson, impersonateEmail) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);

  // JWT Header
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  // JWT Claim Set
  const claimSet = base64UrlEncode(JSON.stringify({
    iss: sa.client_email,
    sub: impersonateEmail, // Send as this user
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  // Sign with private key
  const signInput = `${header}.${claimSet}`;
  const privateKeyPem = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/(\r\n|\n|\r)/gm, '');

  const privateKeyBuffer = str2ab(atob(privateKeyPem));

  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    new TextEncoder().encode(signInput)
  );

  const jwt = `${signInput}.${base64UrlEncode(signature)}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google OAuth failed: ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GMAIL SEND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildRFC2822Email({ from, to, subject, body, replyTo }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
  ];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push('', body);
  return lines.join('\r\n');
}

export async function sendGmail({ to, subject, body, replyTo, env }) {
  const senderEmail = env.GMAIL_SENDER || 'operations@metroglasspro.com';

  // Get OAuth token
  const accessToken = await getGoogleAccessToken(
    env.GOOGLE_SERVICE_ACCOUNT,
    senderEmail
  );

  // Build RFC 2822 email
  const rawEmail = buildRFC2822Email({
    from: `MetroGlass Pro <${senderEmail}>`,
    to,
    subject,
    body,
    replyTo: replyTo || senderEmail,
  });

  // Base64url encode for Gmail API
  const encodedEmail = base64UrlEncode(rawEmail);

  // Send via Gmail API
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${senderEmail}/messages/send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedEmail }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed: ${err}`);
  }

  const result = await res.json();
  return {
    success: true,
    messageId: result.id,
    threadId: result.threadId,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DRAFT QUEUE — stores pending emails in KV for review/approve flow
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class DraftQueue {
  constructor(kv) {
    this.kv = kv;
  }

  async addDraft(draft) {
    const id = `draft:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id,
      status: 'pending', // pending → approved → sent | skipped
      createdAt: new Date().toISOString(),
      architectName: draft.architectName,
      architectLicense: draft.architectLicense,
      recipientEmail: draft.recipientEmail || null, // null until architect email is found
      subject: draft.subject,
      body: draft.body,
      projectAddress: draft.projectAddress,
      score: draft.score,
    };
    await this.kv.put(id, JSON.stringify(record), { expirationTtl: 30 * 86400 }); // 30 day TTL
    return record;
  }

  async getDraft(id) {
    const val = await this.kv.get(id, 'json');
    return val;
  }

  async updateDraft(id, updates) {
    const existing = await this.getDraft(id);
    if (!existing) throw new Error(`Draft ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await this.kv.put(id, JSON.stringify(updated), { expirationTtl: 30 * 86400 });
    return updated;
  }

  async getPendingDrafts() {
    const list = await this.kv.list({ prefix: 'draft:' });
    const drafts = [];
    for (const key of list.keys) {
      const val = await this.kv.get(key.name, 'json');
      if (val && val.status === 'pending') drafts.push(val);
    }
    return drafts.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  async getAllDrafts() {
    const list = await this.kv.list({ prefix: 'draft:' });
    const drafts = [];
    for (const key of list.keys) {
      const val = await this.kv.get(key.name, 'json');
      if (val) drafts.push(val);
    }
    return drafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES — for the review/approve dashboard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function handleGmailRoutes(request, env) {
  const url = new URL(request.url);

  // GET /drafts — list all pending drafts
  if (url.pathname === '/drafts' && request.method === 'GET') {
    return handleListDrafts(env);
  }

  // POST /drafts/:id/approve — approve and send a draft
  if (url.pathname.match(/^\/drafts\/[^/]+\/approve$/) && request.method === 'POST') {
    const id = url.pathname.split('/')[2];
    return handleApproveDraft(id, request, env);
  }

  // POST /drafts/:id/edit — edit a draft (update subject/body/recipient)
  if (url.pathname.match(/^\/drafts\/[^/]+\/edit$/) && request.method === 'POST') {
    const id = url.pathname.split('/')[2];
    return handleEditDraft(id, request, env);
  }

  // POST /drafts/:id/skip — skip a draft
  if (url.pathname.match(/^\/drafts\/[^/]+\/skip$/) && request.method === 'POST') {
    const id = url.pathname.split('/')[2];
    return handleSkipDraft(id, env);
  }

  return null; // not a gmail route
}

async function handleListDrafts(env) {
  const queue = new DraftQueue(env.PERMIT_PULSE);
  const pending = await queue.getPendingDrafts();
  return jsonResponse(pending);
}

async function handleApproveDraft(draftId, request, env) {
  const queue = new DraftQueue(env.PERMIT_PULSE);
  const draft = await queue.getDraft(`draft:${draftId}`);

  if (!draft) return jsonResponse({ error: 'Draft not found' }, 404);
  if (!draft.recipientEmail) return jsonResponse({ error: 'No recipient email set. Edit the draft first to add the architect email.' }, 400);

  try {
    // Send via Gmail
    const result = await sendGmail({
      to: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body,
      env,
    });

    // Update draft status
    await queue.updateDraft(draft.id, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
    });

    return jsonResponse({ success: true, messageId: result.messageId });
  } catch (err) {
    return jsonResponse({ error: `Send failed: ${err.message}` }, 500);
  }
}

async function handleEditDraft(draftId, request, env) {
  const queue = new DraftQueue(env.PERMIT_PULSE);
  const updates = await request.json();

  try {
    const updated = await queue.updateDraft(`draft:${draftId}`, {
      ...(updates.recipientEmail && { recipientEmail: updates.recipientEmail }),
      ...(updates.subject && { subject: updates.subject }),
      ...(updates.body && { body: updates.body }),
    });
    return jsonResponse(updated);
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

async function handleSkipDraft(draftId, env) {
  const queue = new DraftQueue(env.PERMIT_PULSE);
  try {
    const updated = await queue.updateDraft(`draft:${draftId}`, { status: 'skipped' });
    return jsonResponse(updated);
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
