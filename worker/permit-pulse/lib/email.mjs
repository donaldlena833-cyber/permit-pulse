import { getDomainFromEmail, getLocalPart, looksLikeEmail, normalizeText } from './utils.mjs';

export const FREE_MAILBOX_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'aol.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mail.com',
  'protonmail.com',
  'ymail.com',
  'msn.com',
  'comcast.net',
  'verizon.net',
  'att.net',
];

export const GENERIC_INBOXES = [
  'info',
  'contact',
  'office',
  'admin',
  'sales',
  'hello',
  'support',
  'help',
  'service',
  'enquiries',
  'inquiries',
  'general',
  'mail',
  'team',
  'staff',
];

export const PLACEHOLDER_EMAIL_LOCALS = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'example',
  'sample',
  'test',
  'demo',
  'invalid',
  'yourname',
  'email',
];

export const BLOCKED_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'schema.org',
  'sentry.io',
  'wixpress.com',
  'wixsite.com',
  'wordpress.com',
  'secureserver.net',
  'godaddy.com',
];

export function isFreeMailbox(domain) {
  return FREE_MAILBOX_DOMAINS.includes(normalizeText(domain));
}

export function isGenericInbox(localPart) {
  return GENERIC_INBOXES.includes(normalizeText(localPart).split('+')[0]);
}

export function isPlaceholderEmail(email) {
  return PLACEHOLDER_EMAIL_LOCALS.includes(getLocalPart(email));
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isBlockedEmail(email) {
  if (!looksLikeEmail(email)) {
    return true;
  }
  const domain = getDomainFromEmail(email);
  return (
    !domain
    || isPlaceholderEmail(email)
    || BLOCKED_EMAIL_DOMAINS.some((entry) => domain === entry || domain.endsWith(`.${entry}`))
  );
}
