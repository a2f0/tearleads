import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import { toBuffer } from "./buffer";
import type { RecipientEntry } from "./types";

/** ML-KEM-1024 secret key layout: dk_pke (1536 bytes) || ek_pke (1568 bytes) || H(ek) || z */
const ML_KEM1024_PK_OFFSET = 1536;
const ML_KEM1024_PK_LENGTH = 1568;

/**
 * Unwrap a DEK from a set of recipient entries using a recipient's ML-KEM secret key.
 * Finds the matching recipient entry by key fingerprint lookup.
 */
export async function unwrapDek(
  recipients: RecipientEntry[],
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const publicKey = secretKey.slice(
    ML_KEM1024_PK_OFFSET,
    ML_KEM1024_PK_OFFSET + ML_KEM1024_PK_LENGTH,
  );
  const keyFingerprint = await toFingerprint(publicKey);

  const recipient = recipients.find((r) => r.keyFingerprint === keyFingerprint);

  if (!recipient) {
    throw new Error("No matching recipient entry found for this secret key");
  }

  const { kemCipherText, wrappedKey } = recipient;

  const sharedSecret = ml_kem1024.decapsulate(kemCipherText, secretKey);

  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(sharedSecret),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const wrappedKeyIv = kemCipherText.slice(0, 12);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedKeyIv },
      wrappingKey,
      toBuffer(wrappedKey),
    ),
  );
}
