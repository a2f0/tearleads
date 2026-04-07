import {
  decryptAsRecipient,
  parseBlobEnvelope,
  parseBlobEnvelopeHeader,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { SerializedRecipientEnvelope } from "@tearleads/loro";
import type { BlobBytes } from "./blob-store";

export { serializeBlobEnvelope } from "@tearleads/crypto";

function sortRecipientEnvelopes(
  envelopes: ReadonlyArray<SerializedRecipientEnvelope>,
): SerializedRecipientEnvelope[] {
  return [...envelopes].sort((left, right) =>
    left.keyFingerprint.localeCompare(right.keyFingerprint),
  );
}

export async function decryptBlobEnvelope(
  encryptedBytes: string,
  secretKey: Uint8Array,
): Promise<BlobBytes> {
  return decryptAsRecipient(parseBlobEnvelope(encryptedBytes), secretKey);
}

export async function rewrapBlobRecipientEnvelopes(input: {
  encryptedBytes: string;
  recipientPublicKeys: Uint8Array[];
  secretKey: Uint8Array;
}): Promise<SerializedRecipientEnvelope[]> {
  const envelopeHeader = parseBlobEnvelopeHeader(input.encryptedBytes);
  const blobKey = await unwrapDek(
    envelopeHeader.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: base64ToBytes(recipient.kemCipherText),
      wrappedKey: base64ToBytes(recipient.wrappedKey),
    })),
    input.secretKey,
  );
  const wrappedRecipients = await wrapDekForRecipients(
    blobKey,
    input.recipientPublicKeys,
  );

  return sortRecipientEnvelopes(
    wrappedRecipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  );
}
