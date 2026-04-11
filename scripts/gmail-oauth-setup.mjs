#!/usr/bin/env node

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const callbackPort = 3847;
const redirectUri = `http://localhost:${callbackPort}/oauth/callback`;
const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    args[current.slice(2)] = argv[index + 1];
    index += 1;
  }

  return args;
}

function loadEnvFiles() {
  const files = [path.join(repoRoot, ".env"), path.join(repoRoot, ".env.local")];
  const values = {};

  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }

  return values;
}

function getEnv(name, envValues) {
  return process.env[name] || envValues[name] || "";
}

async function promptIfMissing(label, currentValue) {
  if (currentValue) return currentValue;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${label}: `);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message
      || payload?.error_description
      || payload?.error
      || response.statusText
      || "Request failed";
    throw new Error(message);
  }

  return payload;
}

async function fetchTenant({ slug, supabaseUrl, supabaseServiceRoleKey }) {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: "id,slug,name,sender_email",
    limit: "1",
  });

  const rows = await fetchJson(`${supabaseUrl}/rest/v1/v2_tenants?${params.toString()}`, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Tenant "${slug}" was not found in v2_tenants`);
  }

  return rows[0];
}

async function encryptSecret(secretValue, secretKey, { supabaseUrl, supabaseServiceRoleKey }) {
  const payload = await fetchJson(`${supabaseUrl}/rest/v1/rpc/encrypt_gmail_secret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({
      secret_value: secretValue,
      secret_key: secretKey,
    }),
  });

  if (typeof payload !== "string" || !payload) {
    throw new Error("Encryption RPC did not return ciphertext");
  }

  return payload;
}

function waitForOAuthCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", redirectUri);
      if (url.pathname !== "/oauth/callback") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error) {
        response.statusCode = 400;
        response.end("OAuth authorization failed. You can close this tab.");
        server.close(() => reject(new Error(`OAuth error: ${error}`)));
        return;
      }

      if (!code || state !== expectedState) {
        response.statusCode = 400;
        response.end("Invalid callback state. You can close this tab.");
        server.close(() => reject(new Error("OAuth callback state mismatch")));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<html><body><h2>Gmail connected.</h2><p>You can close this window and return to the terminal.</p></body></html>");
      server.close(() => resolve(code));
    });

    server.listen(callbackPort, "127.0.0.1", () => {
      console.log(`Listening for the OAuth callback on ${redirectUri}`);
    });
  });
}

function openUrl(url) {
  return new Promise((resolve) => {
    const child = spawn("open", [url], { stdio: "ignore" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

async function exchangeCodeForTokens({ code, clientId, clientSecret }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  return fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function upsertCredential(row, { supabaseUrl, supabaseServiceRoleKey }) {
  const result = await fetchJson(`${supabaseUrl}/rest/v1/v2_tenant_gmail_credentials?on_conflict=tenant_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
    body: JSON.stringify([row]),
  });

  return Array.isArray(result) ? result[0] : result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = args.tenant;
  const gmailAddress = args.email;

  if (!tenantSlug || !gmailAddress) {
    throw new Error('Usage: node scripts/gmail-oauth-setup.mjs --tenant <slug> --email <workspace-email>');
  }

  const envValues = loadEnvFiles();
  const supabaseUrl = getEnv("SUPABASE_URL", envValues);
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY", envValues);
  const encryptionKey = getEnv("GMAIL_TOKEN_ENCRYPTION_KEY", envValues);
  const clientId = await promptIfMissing("GMAIL_CLIENT_ID", getEnv("GMAIL_CLIENT_ID", envValues));
  const clientSecret = await promptIfMissing("GMAIL_CLIENT_SECRET", getEnv("GMAIL_CLIENT_SECRET", envValues));

  if (!supabaseUrl || !supabaseServiceRoleKey || !encryptionKey) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GMAIL_TOKEN_ENCRYPTION_KEY must be set in your environment or .env.local");
  }
  if (!clientId || !clientSecret) {
    throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required");
  }

  const tenant = await fetchTenant({
    slug: tenantSlug,
    supabaseUrl,
    supabaseServiceRoleKey,
  });

  const state = randomBytes(24).toString("hex");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", gmailScopes.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  console.log(`Preparing Gmail OAuth for ${tenant.name} (${tenant.slug})`);
  console.log("If Google opens a warning page, confirm that the OAuth consent screen is in Production and that this redirect URI is allowed:");
  console.log(`  ${redirectUri}`);
  console.log(`Opening: ${authUrl.toString()}`);

  const codePromise = waitForOAuthCode(state);
  await openUrl(authUrl.toString());
  const code = await codePromise;
  const tokenResponse = await exchangeCodeForTokens({
    code,
    clientId,
    clientSecret,
  });

  if (!tokenResponse.refresh_token) {
    throw new Error("Google did not return a refresh token. Make sure prompt=consent is used and the OAuth app is in Production.");
  }

  const [encryptedClientSecret, encryptedRefreshToken] = await Promise.all([
    encryptSecret(clientSecret, encryptionKey, { supabaseUrl, supabaseServiceRoleKey }),
    encryptSecret(tokenResponse.refresh_token, encryptionKey, { supabaseUrl, supabaseServiceRoleKey }),
  ]);

  const stored = await upsertCredential({
    tenant_id: tenant.id,
    gmail_address: gmailAddress,
    client_id: clientId,
    client_secret_encrypted: encryptedClientSecret,
    refresh_token_encrypted: encryptedRefreshToken,
    token_status: "active",
    updated_at: new Date().toISOString(),
  }, {
    supabaseUrl,
    supabaseServiceRoleKey,
  });

  console.log("");
  console.log("Gmail OAuth setup complete.");
  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);
  console.log(`Stored Gmail address: ${stored.gmail_address || gmailAddress}`);
  console.log("Next: log into the app and confirm Gmail status shows as connected for this tenant.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
