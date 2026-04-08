import {
  decryptAsRecipient,
  decryptWithDek,
  parseBlobEnvelope,
  parseBlobEnvelopeHeader,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { SerializedRecipientEnvelope } from "@tearleads/loro";
import type { BlobBytes } from "./blob-store";
import { unwrapRecipientEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";
import type { ExecSql } from "./sqlSchema";

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
  execSql?: ExecSql,
): Promise<BlobBytes> {
  const parsedEnvelope = parseBlobEnvelope(encryptedBytes);

  try {
    return await decryptAsRecipient(parsedEnvelope, secretKey);
  } catch {
    if (!execSql) {
      throw new Error(
        "Blob envelope could not be decrypted with the local user key",
      );
    }
  }

  const blobKey = await unwrapRecipientEnvelopesWithPrincipalPolicies({
    envelopes: parsedEnvelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
    execSql,
    secretKey,
  });

  return new Uint8Array(
    await decryptWithDek(
      {
        iv: parsedEnvelope.iv,
        ciphertext: parsedEnvelope.ciphertext,
      },
      blobKey,
    ),
  );
}

export async function rewrapBlobRecipientEnvelopes(input: {
  encryptedBytes: string;
  execSql?: ExecSql;
  recipientPublicKeys: Uint8Array[];
  secretKey: Uint8Array;
}): Promise<SerializedRecipientEnvelope[]> {
  const envelopeHeader = parseBlobEnvelopeHeader(input.encryptedBytes);
  const blobKey = await unwrapRecipientEnvelopesWithPrincipalPolicies({
    envelopes: envelopeHeader.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: recipient.kemCipherText,
      wrappedKey: recipient.wrappedKey,
    })),
    execSql: input.execSql,
    secretKey: input.secretKey,
  });
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
