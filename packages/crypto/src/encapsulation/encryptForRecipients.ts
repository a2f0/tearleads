import { toBuffer } from "./buffer";
import type { EncryptedEnvelope } from "./types";
import { wrapDekForRecipients } from "./wrapDek";

/**
 * Encrypt a payload so that multiple recipients can each independently decrypt it.
 * Uses ML-KEM-1024 (FIPS 203) for key encapsulation and AES-256-GCM for payload encryption.
 */
export async function encryptForRecipients(
  plaintext: Uint8Array,
  recipientPublicKeys: Uint8Array[],
): Promise<EncryptedEnvelope> {
  const payloadKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aesKey = await crypto.subtle.importKey(
    "raw",
    payloadKey,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      toBuffer(plaintext),
    ),
  );

  const recipients = await wrapDekForRecipients(
    payloadKey,
    recipientPublicKeys,
  );

  return { iv, ciphertext, recipients };
}
