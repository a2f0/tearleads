import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import { AES_GCM_IV_BYTES } from "../symmetric";
import { ML_KEM1024_PUBLIC_KEY_BYTES } from "./generateKeyPair";
import type { RecipientEntry } from "./types";

/**
 * Wrap an existing DEK for multiple recipients using ML-KEM-1024.
 * Unlike encryptForRecipients, this does not encrypt a payload —
 * it only wraps the key material for each recipient.
 */
export async function wrapDekForRecipients(
  dek: Uint8Array,
  recipientPublicKeys: Uint8Array[],
): Promise<RecipientEntry[]> {
  if (dek.length === 0) {
    throw new Error("Wrapped key material must not be empty");
  }
  if (recipientPublicKeys.length === 0) {
    throw new Error("At least one recipient public key is required");
  }

  const fingerprints = await Promise.all(
    recipientPublicKeys.map(async (publicKey, index) => {
      if (publicKey.length !== ML_KEM1024_PUBLIC_KEY_BYTES) {
        throw new Error(`Recipient public key[${index}] has invalid length`);
      }
      return toFingerprint(publicKey);
    }),
  );
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new Error("Recipient public keys must be unique");
  }

  return Promise.all(
    recipientPublicKeys.map(async (publicKey, index) => {
      const { cipherText: kemCipherText, sharedSecret } =
        ml_kem1024.encapsulate(publicKey);

      const wrappingKey = await crypto.subtle.importKey(
        "raw",
        sharedSecret.slice(),
        "AES-GCM",
        false,
        ["encrypt"],
      );
      const wrappedKeyIv = kemCipherText.slice(0, AES_GCM_IV_BYTES);
      const wrappedKey = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: wrappedKeyIv },
          wrappingKey,
          dek.slice(),
        ),
      );

      return {
        keyFingerprint: fingerprints[index] ?? "",
        kemCipherText,
        wrappedKey,
      };
    }),
  );
}
