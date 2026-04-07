export interface SymmetricCiphertext {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

async function importSymmetricKey(
  keyBytes: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes.slice(), "AES-GCM", false, [
    usage,
  ]);
}

export async function encryptWithDek(
  plaintext: Uint8Array,
  dek: Uint8Array,
): Promise<SymmetricCiphertext> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
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
  const key = await importSymmetricKey(dek, "decrypt");

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: encrypted.iv.slice() },
      key,
      encrypted.ciphertext.slice(),
    ),
  );
}
