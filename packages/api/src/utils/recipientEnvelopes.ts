import { parseBlobEnvelopeHeader } from "@tearleads/crypto";

export interface PersistedRecipientEnvelopeEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export function extractBlobRecipientEnvelopeEntries(
  encryptedBytes: string,
): PersistedRecipientEnvelopeEntry[] {
  return parseBlobEnvelopeHeader(encryptedBytes).recipients.map(
    (recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: recipient.kemCipherText,
      wrappedKey: recipient.wrappedKey,
    }),
  );
}
