import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  parseBlobEnvelope,
  parseBlobEnvelopeHeader,
  replaceBlobEnvelopeRecipients,
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

test("blob envelope recipients can be replaced without rewriting ciphertext", async () => {
  const alice = generateKemSeedAndKeyPair();
  const plaintext = new TextEncoder().encode("replace recipients");
  const envelope = await encryptForRecipients(plaintext, [alice.publicKey]);
  const serialized = serializeBlobEnvelope(envelope);
  const replacement = {
    keyFingerprint: "fp_02",
    kemCipherText: "cmV3cmFwLWtlbQ==",
    wrappedKey: "cmV3cmFwLXdyYXA=",
  };

  const replaced = replaceBlobEnvelopeRecipients(serialized, [replacement]);
  const replacedHeader = parseBlobEnvelopeHeader(replaced);
  const [, , originalCiphertext] = serialized.split("\n");
  const [, , replacedCiphertext] = replaced.split("\n");

  expect(replacedHeader).toEqual({
    iv: bytesToBase64(envelope.iv),
    recipients: [replacement],
  });
  expect(replacedCiphertext).toBe(originalCiphertext);
});

test("legacy v1 blob envelopes are rejected", async () => {
  const alice = generateKemSeedAndKeyPair();
  const plaintext = new TextEncoder().encode("legacy blob bytes");
  const envelope = await encryptForRecipients(plaintext, [alice.publicKey]);
  const legacyEncryptedBytes = JSON.stringify({
    format: "tearleads.blob.v1",
    iv: bytesToBase64(envelope.iv),
    ciphertext: bytesToBase64(envelope.ciphertext),
    recipients: envelope.recipients.map((recipient) => ({
      keyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
    })),
  });

  expect(() => parseBlobEnvelopeHeader(legacyEncryptedBytes)).toThrow(
    "Invalid encrypted blob envelope",
  );
  expect(() => parseBlobEnvelope(legacyEncryptedBytes)).toThrow(
    "Invalid encrypted blob envelope",
  );
});
