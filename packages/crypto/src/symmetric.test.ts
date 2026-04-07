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

  expect(decryptWithDek(encrypted, wrongDek)).rejects.toThrow();
});
