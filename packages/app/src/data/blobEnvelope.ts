import {
  decryptAsRecipient,
  decryptWithDek,
  parseBlobEnvelope,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { BlobBytes } from "./blobs";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";
import type { ExecSql } from "./sqlite/sqlSchema";

export { serializeBlobEnvelope } from "@tearleads/crypto";

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

  const blobKey = await unwrapKeyEnvelopesWithPrincipalPolicies({
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
