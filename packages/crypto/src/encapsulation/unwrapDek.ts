import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import { AES_GCM_IV_BYTES, AES_GCM_TAG_BYTES } from "../symmetric";
import {
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
} from "./generateKeyPair";
import type { RecipientEntry } from "./types";

/** ML-KEM-1024 secret key layout: dk_pke (1536 bytes) || ek_pke (1568 bytes) || H(ek) || z */
const ML_KEM1024_PK_OFFSET = 1536;

/**
 * Unwrap a DEK from a set of recipient entries using a recipient's ML-KEM secret key.
 * Finds the matching recipient entry by key fingerprint lookup.
 */
export async function unwrapDek(
  recipients: RecipientEntry[],
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  if (secretKey.length !== ML_KEM1024_SECRET_KEY_BYTES) {
    throw new Error("ML-KEM-1024 secret key has invalid length");
  }

  const publicKey = secretKey.slice(
    ML_KEM1024_PK_OFFSET,
    ML_KEM1024_PK_OFFSET + ML_KEM1024_PUBLIC_KEY_BYTES,
  );
  const keyFingerprint = await toFingerprint(publicKey);

  const recipient = recipients.find((r) => r.keyFingerprint === keyFingerprint);

  if (!recipient) {
    throw new Error("No matching recipient entry found for this secret key");
  }

  const { kemCipherText, wrappedKey } = recipient;
  if (kemCipherText.length !== ML_KEM1024_CIPHERTEXT_BYTES) {
    throw new Error("Recipient KEM ciphertext has invalid length");
  }
  if (wrappedKey.length < AES_GCM_TAG_BYTES) {
    throw new Error("Wrapped key ciphertext is too short");
  }

  const sharedSecret = ml_kem1024.decapsulate(kemCipherText, secretKey);

  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret.slice(),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const wrappedKeyIv = kemCipherText.slice(0, AES_GCM_IV_BYTES);
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedKeyIv },
      wrappingKey,
      wrappedKey.slice(),
    ),
  );
  if (dek.length === 0) {
    throw new Error("Wrapped key material is empty");
  }

  return dek;
}
