export interface SymmetricCiphertext {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export const AES_256_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

function assertAes256Key(keyBytes: Uint8Array): void {
  if (keyBytes.length !== AES_256_KEY_BYTES) {
    throw new Error("AES-256-GCM requires a 32-byte key");
  }
}

function assertAesGcmCiphertext(encrypted: SymmetricCiphertext): void {
  if (encrypted.iv.length !== AES_GCM_IV_BYTES) {
    throw new Error("AES-GCM IV must be 12 bytes");
  }
  if (encrypted.ciphertext.length < AES_GCM_TAG_BYTES) {
    throw new Error("AES-GCM ciphertext is too short");
  }
}

async function importSymmetricKey(
  keyBytes: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  assertAes256Key(keyBytes);
  return crypto.subtle.importKey("raw", keyBytes.slice(), "AES-GCM", false, [
    usage,
  ]);
}

export async function encryptWithDek(
  plaintext: Uint8Array,
  dek: Uint8Array,
): Promise<SymmetricCiphertext> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await importSymmetricKey(dek, "encrypt");

  return {
    iv,
    ciphertext: new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext.slice(),
      ),
    ),
  };
}

export async function decryptWithDek(
  encrypted: SymmetricCiphertext,
  dek: Uint8Array,
): Promise<Uint8Array> {
  assertAesGcmCiphertext(encrypted);
  const key = await importSymmetricKey(dek, "decrypt");

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: encrypted.iv.slice() },
      key,
      encrypted.ciphertext.slice(),
    ),
  );
}
