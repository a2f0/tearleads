import type { EmailAddress } from '../types/email.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function parseRecipientAddress(
  rawAddress: string
): { localPart: string; domain: string } | null {
  const address = rawAddress.trim().toLowerCase();
  const atIndex = address.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === address.length - 1) {
    return null;
  }
  return {
    localPart: address.slice(0, atIndex),
    domain: address.slice(atIndex + 1)
  };
}

function isUuidLocalPart(value: string): boolean {
  return UUID_RE.test(value);
}

export function resolveRecipientUserIds(input: {
  rcptTo: EmailAddress[];
  allowedDomains: Set<string> | null;
  recipientAddressing: 'uuid-local-part' | 'legacy-local-part';
}): string[] {
  const userIds = new Set<string>();

  for (const recipient of input.rcptTo) {
    const parsed = parseRecipientAddress(recipient.address);
    if (!parsed) {
      continue;
    }
    if (input.allowedDomains && !input.allowedDomains.has(parsed.domain)) {
      continue;
    }
    if (
      input.recipientAddressing === 'uuid-local-part' &&
      !isUuidLocalPart(parsed.localPart)
    ) {
      continue;
    }
    userIds.add(parsed.localPart);
  }

  return Array.from(userIds);
}
