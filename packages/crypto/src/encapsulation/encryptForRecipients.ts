import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import { toBuffer } from "./buffer";
import type { EncryptedEnvelope, RecipientEntry } from "./types";

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

  const recipients: RecipientEntry[] = await Promise.all(
    recipientPublicKeys.map(async (publicKey) => {
      const { cipherText: kemCipherText, sharedSecret } =
        ml_kem1024.encapsulate(publicKey);

      const wrappingKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(sharedSecret),
        "AES-GCM",
        false,
        ["encrypt"],
      );
      const wrappedKeyIv = kemCipherText.slice(0, 12);
      const wrappedKey = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: wrappedKeyIv },
          wrappingKey,
          toBuffer(payloadKey),
        ),
      );

      return {
        keyFingerprint: await toFingerprint(publicKey),
        kemCipherText,
        wrappedKey,
      };
    }),
  );

  return { iv, ciphertext, recipients };
}
