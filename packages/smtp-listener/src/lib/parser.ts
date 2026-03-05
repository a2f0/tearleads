import type {
  EmailAddress,
  EmailEnvelope,
  StoredEmail
} from '../types/email.js';

export function generateEmailId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

export function parseAddress(address: string): EmailAddress {
  const trimmed = address.trim();
  const leftBracket = trimmed.lastIndexOf('<');
  const rightBracket = trimmed.endsWith('>')
    ? trimmed.length - 1
    : trimmed.lastIndexOf('>');

  if (
    leftBracket >= 0 &&
    rightBracket > leftBracket &&
    rightBracket === trimmed.length - 1
  ) {
    const parsedAddress = trimmed.slice(leftBracket + 1, rightBracket).trim();
    if (parsedAddress.length > 0) {
      const rawName = trimmed.slice(0, leftBracket).trim();
      const maybeQuotedName =
        rawName.startsWith('"') && rawName.endsWith('"')
          ? rawName.slice(1, -1).trim()
          : rawName;

      return maybeQuotedName
        ? { address: parsedAddress, name: maybeQuotedName }
        : { address: parsedAddress };
    }
  }

  return { address: trimmed };
}

export function createStoredEmail(
  envelope: EmailEnvelope,
  rawData: string
): StoredEmail {
  return {
    id: generateEmailId(),
    envelope,
    rawData,
    receivedAt: new Date().toISOString(),
    size: Buffer.byteLength(rawData, 'utf8')
  };
}
