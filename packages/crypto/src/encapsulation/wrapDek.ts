import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import { toBuffer } from "./buffer";
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
  return Promise.all(
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
          toBuffer(dek),
        ),
      );

      return {
        keyFingerprint: await toFingerprint(publicKey),
        kemCipherText,
        wrappedKey,
      };
    }),
  );
}
