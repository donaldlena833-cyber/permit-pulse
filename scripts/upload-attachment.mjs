#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

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

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText || "Request failed";
    throw new Error(message);
  }

  return payload;
}

async function fetchTenant({ slug, supabaseUrl, supabaseServiceRoleKey }) {
  const params = new URLSearchParams({
    slug: `eq.${slug}`,
    select: "id,slug,name,attachment_kv_key",
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

function runWranglerKvPut(key, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "kv", "key", "put", "--binding=PERMIT_PULSE", key, "--path", filePath], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`wrangler kv key put exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantSlug = args.tenant;
  const fileArg = args.file;

  if (!tenantSlug || !fileArg) {
    throw new Error('Usage: node scripts/upload-attachment.mjs --tenant <slug> --file "/absolute/path/About Us.pdf"');
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  if (!existsSync(filePath)) {
    throw new Error(`Attachment file was not found: ${filePath}`);
  }

  const envValues = loadEnvFiles();
  const supabaseUrl = getEnv("SUPABASE_URL", envValues);
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY", envValues);

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in your environment or .env.local");
  }

  const tenant = await fetchTenant({
    slug: tenantSlug,
    supabaseUrl,
    supabaseServiceRoleKey,
  });

  if (!tenant.attachment_kv_key) {
    throw new Error(`Tenant "${tenant.slug}" does not have attachment_kv_key configured`);
  }

  console.log(`Uploading ${path.basename(filePath)} for ${tenant.name} to KV key ${tenant.attachment_kv_key}`);
  await runWranglerKvPut(tenant.attachment_kv_key, filePath);
  console.log("Attachment upload complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
