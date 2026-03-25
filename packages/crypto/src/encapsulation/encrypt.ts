import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { toFingerprint } from "../fingerprint";
import type { EncryptedEnvelope, RecipientEntry } from "./types";

export type { EncryptedEnvelope, RecipientEntry } from "./types";

/** Copy into a fresh ArrayBuffer-backed Uint8Array for crypto.subtle compatibility. */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return view;
}

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
    toBuffer(sharedSecret),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const wrappedKeyIv = kemCipherText.slice(0, 12);
  const payloadKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrappedKeyIv },
      wrappingKey,
      toBuffer(wrappedKey),
    ),
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(payloadKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBuffer(envelope.iv) },
      aesKey,
      toBuffer(envelope.ciphertext),
    ),
  );
}
