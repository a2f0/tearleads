import { AES_256_KEY_BYTES, AES_GCM_IV_BYTES } from "../symmetric";
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
  const payloadKey = crypto.getRandomValues(new Uint8Array(AES_256_KEY_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));

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
      plaintext.slice(),
    ),
  );

  const recipients = await wrapDekForRecipients(
    payloadKey,
    recipientPublicKeys,
  );

  return { iv, ciphertext, recipients };
}
