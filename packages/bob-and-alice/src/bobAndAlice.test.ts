import { expect, test } from "bun:test";
import {
  bytesToHex,
  decryptAsRecipient,
  encryptForRecipients,
  hexToBytes,
  sign,
  verify,
} from "@symcrypt/crypto";
import invariant from "invariant";
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

test("eve cannot tamper with bob's encrypted payload in transit", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  const messageToAlice = "Hello, Alice";
  const signature = sign(
    new TextEncoder().encode(messageToAlice),
    bob.signing.signingPrivateKey,
  );
  const signedPayload = new TextEncoder().encode(
    JSON.stringify({
      message: messageToAlice,
      signature: bytesToHex(signature),
    }),
  );

  const envelope = await encryptForRecipients(signedPayload, [
    alice.kem.publicKey,
  ]);
  const tamperedCiphertext = envelope.ciphertext.slice();
  invariant(tamperedCiphertext[0], "Ciphertext must not be empty");
  tamperedCiphertext[0] ^= 0x01;

  await expect(
    decryptAsRecipient(
      {
        ...envelope,
        ciphertext: tamperedCiphertext,
      },
      alice.kem.secretKey,
    ),
  ).rejects.toThrow();
});

test("eve cannot impersonate bob just by knowing alice's public key", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  const bobMessage = "Hello, Alice";
  const bobSignature = sign(
    new TextEncoder().encode(bobMessage),
    bob.signing.signingPrivateKey,
  );

  const forgedMessage = "Hi Alice, Bob changed his mind";
  const forgedPayload = new TextEncoder().encode(
    JSON.stringify({
      message: forgedMessage,
      signature: bytesToHex(bobSignature),
    }),
  );

  const forgedEnvelope = await encryptForRecipients(forgedPayload, [
    alice.kem.publicKey,
  ]);
  const decryptedPayload = await decryptAsRecipient(
    forgedEnvelope,
    alice.kem.secretKey,
  );

  const { message, signature } = JSON.parse(
    new TextDecoder().decode(decryptedPayload),
  ) as {
    message: string;
    signature: string;
  };

  expect(message).toBe(forgedMessage);
  expect(
    verify(
      hexToBytes(signature),
      new TextEncoder().encode(message),
      bob.signing.signingPublicKey,
    ),
  ).toBe(false);
});
