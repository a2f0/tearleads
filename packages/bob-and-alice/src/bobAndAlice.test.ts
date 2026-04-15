import { expect, test } from "bun:test";
import {
  bytesToHex,
  decryptAsRecipient,
  encryptForRecipients,
  hexToBytes,
  sign,
  verify,
} from "@tearleads/crypto";
import { createTestUser } from "./createTestUser";

test("bob can write a message to alice", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  expect(alice).not.toBe(bob);
  expect(alice.signing.signingPublicKey.length).toBeGreaterThan(0);
  expect(alice.kem.publicKey.length).toBeGreaterThan(0);
  expect(bob.signing.signingPublicKey.length).toBeGreaterThan(0);
  expect(bob.kem.publicKey.length).toBeGreaterThan(0);
  expect(alice.signing.signingPublicKey).not.toEqual(
    bob.signing.signingPublicKey,
  );
  expect(alice.kem.publicKey).not.toEqual(bob.kem.publicKey);

  const messageToAlice = "Hello, Alice";
  const messageBytes = new TextEncoder().encode(messageToAlice);
  const signature = sign(messageBytes, bob.signing.signingPrivateKey);

  const signedPayload = new TextEncoder().encode(
    JSON.stringify({
      message: messageToAlice,
      signature: bytesToHex(signature),
    }),
  );

  const envelope = await encryptForRecipients(signedPayload, [
    alice.kem.publicKey,
  ]);
  const decryptedPayload = await decryptAsRecipient(
    envelope,
    alice.kem.secretKey,
  );

  const { message, signature: signatureHex } = JSON.parse(
    new TextDecoder().decode(decryptedPayload),
  ) as {
    message: string;
    signature: string;
  };

  expect(
    verify(
      hexToBytes(signatureHex),
      new TextEncoder().encode(message),
      bob.signing.signingPublicKey,
    ),
  ).toBe(true);
  expect(message).toBe(messageToAlice);
});
