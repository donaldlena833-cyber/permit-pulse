const endpoint = String(process.env.PERMIT_PULSE_SCAN_URL || '').trim();
const token = String(process.env.PERMIT_PULSE_ACCESS_TOKEN || '').trim();

console.log('[permit-scanner] compatibility shim');
console.log('[permit-scanner] the canonical automation path now lives in worker/permit-pulse and the operator console UI.');

if (!endpoint) {
  console.log('[permit-scanner] set PERMIT_PULSE_SCAN_URL to POST /api/scan from this script.');
  process.exit(0);
}

const headers = {
  'Content-Type': 'application/json',
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers,
  body: JSON.stringify({}),
});

const text = await response.text();

if (!response.ok) {
  console.error(`[permit-scanner] scan failed: ${response.status}`);
  if (text) {
    console.error(text);
  }
  process.exit(1);
}

console.log('[permit-scanner] scan triggered successfully');
if (text) {
  console.log(text);
}
