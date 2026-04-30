import { expect, test } from "bun:test";
import {
  parseBlobEnvelope,
  parseBlobEnvelopeHeader,
  serializeBlobEnvelope,
} from "./blobEnvelope";
import { decryptAsRecipient } from "./encapsulation/decryptAsRecipient";
import { encryptForRecipients } from "./encapsulation/encryptForRecipients";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";

test("blob envelopes round-trip through the shared wire format", async () => {
  const alice = generateKemSeedAndKeyPair();
  const bob = generateKemSeedAndKeyPair();
  const plaintext = new TextEncoder().encode("shared blob bytes");

  const envelope = await encryptForRecipients(plaintext, [
    alice.publicKey,
    bob.publicKey,
  ]);
  const serialized = serializeBlobEnvelope(envelope);
  const header = parseBlobEnvelopeHeader(serialized);

  expect(serialized.startsWith("tearleads.blob.v2\n")).toBe(true);
  expect(
    header.recipients.map((recipient) => recipient.keyFingerprint),
  ).toEqual(envelope.recipients.map((recipient) => recipient.keyFingerprint));

  const decrypted = await decryptAsRecipient(
    parseBlobEnvelope(serialized),
    alice.secretKey,
  );
  expect(decrypted).toEqual(plaintext);
});

test("blob envelope headers can be read without ciphertext JSON parsing", () => {
  const header = {
    iv: "aGVhZGVyLW9ubHktaXY=",
    recipients: [
      {
        keyFingerprint: "fp_01",
        kemCipherText: "a2VtLWNpcGhlcnRleHQ=",
        wrappedKey: "d3JhcHBlZC1rZXk=",
      },
    ],
  };
  const encryptedBytes = [
    "tearleads.blob.v2",
    JSON.stringify(header),
    "x".repeat(1024 * 1024),
  ].join("\n");

  expect(parseBlobEnvelopeHeader(encryptedBytes)).toEqual(header);
});

test("blob envelopes without the shared wire-format header are rejected", () => {
  const encryptedBytes = JSON.stringify({
    iv: "aXY=",
    ciphertext: "Y2lwaGVydGV4dA==",
    recipients: [],
  });

  expect(() => parseBlobEnvelopeHeader(encryptedBytes)).toThrow(
    "Invalid encrypted blob envelope",
  );
  expect(() => parseBlobEnvelope(encryptedBytes)).toThrow(
    "Invalid encrypted blob envelope",
  );
});
