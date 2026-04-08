const DEFAULT_SECRET_ENV = 'WORKSPACE_TOKEN_ENCRYPTION_KEY';

function compactText(value) {
  return String(value || '').trim();
}

function decodeBase64(value) {
  const normalized = compactText(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s+/g, '');

  if (!normalized) {
    return new Uint8Array();
  }

  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function deriveKeyMaterial(secretValue) {
  const directBytes = decodeBase64(secretValue);
  if (directBytes.length === 32) {
    return directBytes;
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretValue));
  return new Uint8Array(digest);
}

async function loadKey(env, envKey = DEFAULT_SECRET_ENV) {
  const secretValue = compactText(env?.[envKey]);
  if (!secretValue) {
    throw new Error(`${envKey} is required for workspace credential encryption`);
  }

  const keyMaterial = await deriveKeyMaterial(secretValue);
  return crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function serializeEnvelope(iv, ciphertext) {
  return `${encodeBase64(iv)}.${encodeBase64(ciphertext)}`;
}

function parseEnvelope(value) {
  const [ivPart, payloadPart] = compactText(value).split('.');
  const iv = decodeBase64(ivPart);
  const payload = decodeBase64(payloadPart);

  if (iv.length !== 12 || payload.length === 0) {
    throw new Error('Encrypted payload is malformed');
  }

  return { iv, payload };
}

export async function encryptText(env, plaintext, envKey = DEFAULT_SECRET_ENV) {
  const key = await loadKey(env, envKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(String(plaintext || ''));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return serializeEnvelope(iv, new Uint8Array(ciphertext));
}

export async function decryptText(env, encryptedValue, envKey = DEFAULT_SECRET_ENV) {
  const key = await loadKey(env, envKey);
  const { iv, payload } = parseEnvelope(encryptedValue);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
  return new TextDecoder().decode(plaintext);
}

export async function maybeDecryptText(env, encryptedValue, envKey = DEFAULT_SECRET_ENV) {
  const value = compactText(encryptedValue);
  if (!value) {
    return null;
  }

  return decryptText(env, value, envKey);
}
