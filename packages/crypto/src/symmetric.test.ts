import { expect, test } from "bun:test";
import { decryptWithDek, encryptWithDek } from "./symmetric";

test("encryptWithDek and decryptWithDek round-trip plaintext", async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = new TextEncoder().encode("document update bytes");

  const encrypted = await encryptWithDek(plaintext, dek);
  const decrypted = await decryptWithDek(encrypted, dek);

  expect(decrypted).toEqual(plaintext);
});

test("decryptWithDek rejects the wrong key", async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const wrongDek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = new TextEncoder().encode("document update bytes");
  const encrypted = await encryptWithDek(plaintext, dek);

  await expect(decryptWithDek(encrypted, wrongDek)).rejects.toThrow();
});

test("symmetric helpers reject malformed key and IV sizes", async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32));

  await expect(
    encryptWithDek(new TextEncoder().encode("plaintext"), new Uint8Array(16)),
  ).rejects.toThrow("AES-256-GCM requires a 32-byte key");

  await expect(
    decryptWithDek(
      {
        iv: new Uint8Array(8),
        ciphertext: crypto.getRandomValues(new Uint8Array(16)),
      },
      dek,
    ),
  ).rejects.toThrow("AES-GCM IV must be 12 bytes");
});
