import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import type { EncryptedEnvelope } from "./types";

/** ML-KEM-1024 secret key layout: dk_pke (1536 bytes) || ek_pke (1568 bytes) || H(ek) || z */
const ML_KEM1024_PK_OFFSET = 1536;
const ML_KEM1024_PK_LENGTH = 1568;

/**
 * Decrypt an envelope using a recipient's ML-KEM secret key.
 * Finds the matching recipient entry by key fingerprint lookup.
 */
export async function decryptAsRecipient(
  envelope: EncryptedEnvelope,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const publicKey = secretKey.slice(
    ML_KEM1024_PK_OFFSET,
    ML_KEM1024_PK_OFFSET + ML_KEM1024_PK_LENGTH,
  );
  const keyFingerprint = await toFingerprint(publicKey);

  const recipient = envelope.recipients.find(
    (r) => r.keyFingerprint === keyFingerprint,
  );

  if (!recipient) {
    throw new Error("No matching recipient entry found for this secret key");
  }

  const { kemCipherText, wrappedKey } = recipient;

  const sharedSecret = ml_kem1024.decapsulate(kemCipherText, secretKey);

  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret.slice(),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const wrappedKeyIv = kemCipherText.slice(0, 12);
  const payloadKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedKeyIv },
      wrappingKey,
      wrappedKey.slice(),
    ),
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    payloadKey.slice(),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.iv.slice() },
      aesKey,
      envelope.ciphertext.slice(),
    ),
  );
}
