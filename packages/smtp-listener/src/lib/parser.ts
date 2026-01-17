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
  const match = address.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
  if (match) {
    const name = match[1]?.trim();
    const addr = match[2]?.trim();
    if (addr) {
      return name ? { address: addr, name } : { address: addr };
    }
  }
  return { address: address.trim() };
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
