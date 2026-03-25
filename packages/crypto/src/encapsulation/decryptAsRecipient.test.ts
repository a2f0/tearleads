import { expect, test } from "bun:test";
import { decryptAsRecipient } from "./decryptAsRecipient";
import { encryptForRecipients } from "./encryptForRecipients";
import { generateSeedAndKeyPair } from "./generateKeyPair";

test("an outsider cannot decrypt the shared payload", async () => {
  const alice = generateSeedAndKeyPair();
  const bob = generateSeedAndKeyPair();
  const eve = generateSeedAndKeyPair();

  const plaintext = new TextEncoder().encode("not for eve");

  const envelope = await encryptForRecipients(plaintext, [
    alice.publicKey,
    bob.publicKey,
  ]);

  expect(decryptAsRecipient(envelope, eve.secretKey)).rejects.toThrow(
    "No matching recipient entry found",
  );
});
