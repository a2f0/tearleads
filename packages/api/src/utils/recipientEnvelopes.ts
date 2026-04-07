import { parseBlobEnvelopeHeader } from "@tearleads/crypto";
import { readEncryptedUpdateAccessEpoch } from "@tearleads/loro";
import { uniqueSortedStrings } from "./array";

export interface PersistedRecipientEnvelopeEntry {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export function readLoroUpdateAccessEpoch(encryptedData: string): number {
  return readEncryptedUpdateAccessEpoch(encryptedData);
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

export function listBlobRecipientKeyFingerprints(
  encryptedBytes: string,
): string[] {
  return uniqueSortedStrings(
    extractBlobRecipientEnvelopeEntries(encryptedBytes).map(
      (recipient) => recipient.keyFingerprint,
    ),
  );
}
