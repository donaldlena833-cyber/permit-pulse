function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value) {
  return compactText(value).toLowerCase();
}

export function workspaceBusinessName(workspace, fallback = 'our team') {
  return compactText(workspace?.business_name) || compactText(workspace?.name) || fallback;
}

export function workspaceSenderName(workspace) {
  return compactText(workspace?.sender_name) || workspaceBusinessName(workspace);
}

export function workspaceWebsiteLabel(workspace) {
  const website = compactText(workspace?.website);
  if (!website) {
    return null;
  }

  return website.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function workspaceSignatureLines(workspace) {
  const seen = new Set();
  const lines = [
    workspaceSenderName(workspace),
    workspaceBusinessName(workspace),
    compactText(workspace?.phone) || null,
    workspaceWebsiteLabel(workspace),
  ].filter(Boolean);

  return lines.filter((line) => {
    const normalized = compactText(line).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

export function resolveWorkspaceSender(_env, workspace) {
  const mailboxSender = normalizeEmail(workspace?.default_mailbox?.email);
  const configuredSender = normalizeEmail(workspace?.sender_email);
  const sender = mailboxSender || configuredSender || '';
  const replyTo = configuredSender && sender && configuredSender !== sender ? configuredSender : null;

  return { sender, replyTo };
}
