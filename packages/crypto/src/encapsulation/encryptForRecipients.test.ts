import { expect, test } from "bun:test";
import { decryptAsRecipient } from "./decryptAsRecipient";
import { encryptForRecipients } from "./encryptForRecipients";
import { generateSeedAndKeyPair } from "./generateKeyPair";

test("alice and bob can both decrypt a shared payload", async () => {
  const alice = generateSeedAndKeyPair();
  const bob = generateSeedAndKeyPair();

  const plaintext = new TextEncoder().encode(
    "shared secret message for both parties",
  );

  const envelope = await encryptForRecipients(plaintext, [
    alice.publicKey,
    bob.publicKey,
  ]);

  const decryptedByAlice = await decryptAsRecipient(envelope, alice.secretKey);
  const decryptedByBob = await decryptAsRecipient(envelope, bob.secretKey);

  expect(decryptedByAlice).toEqual(plaintext);
  expect(decryptedByBob).toEqual(plaintext);
});

test("single recipient can decrypt", async () => {
  const alice = generateSeedAndKeyPair();

  const plaintext = new TextEncoder().encode("just for alice");

  const envelope = await encryptForRecipients(plaintext, [alice.publicKey]);

  const decrypted = await decryptAsRecipient(envelope, alice.secretKey);
  expect(decrypted).toEqual(plaintext);
});

test("envelope has one recipient entry per public key", async () => {
  const alice = generateSeedAndKeyPair();
  const bob = generateSeedAndKeyPair();
  const carol = generateSeedAndKeyPair();

  const plaintext = new TextEncoder().encode("for three");

  const envelope = await encryptForRecipients(plaintext, [
    alice.publicKey,
    bob.publicKey,
    carol.publicKey,
  ]);

  expect(envelope.recipients).toHaveLength(3);

  expect(await decryptAsRecipient(envelope, alice.secretKey)).toEqual(
    plaintext,
  );
  expect(await decryptAsRecipient(envelope, bob.secretKey)).toEqual(plaintext);
  expect(await decryptAsRecipient(envelope, carol.secretKey)).toEqual(
    plaintext,
  );
});
