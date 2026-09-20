import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  ContentKeyEnvelopeError,
  decodeContentKeyEnvelope,
} from "./contentKeyEnvelope";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "./keying/types";
import { decryptWithDek, encryptWithDek } from "./symmetric";

for (const label of ["Blob", "Document"] as const) {
  const suite =
    label === "Blob"
      ? BLOB_CONTENT_KEY_WRAP_SUITE
      : DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  test(`${label} envelopes accept genuine wraps and still require authenticated decryption`, async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const key = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptWithDek(key, kek);
    const envelope = {
      wrappedKey: bytesToBase64(encrypted.ciphertext),
      wrappingMetadata: { suite, iv: bytesToBase64(encrypted.iv) },
    };
    expect(
      await decryptWithDek(
        decodeContentKeyEnvelope({ envelope, label, suite }),
        kek,
      ),
    ).toEqual(key);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 1;
    const tampered = decodeContentKeyEnvelope({
      envelope: {
        ...envelope,
        wrappedKey: bytesToBase64(encrypted.ciphertext),
      },
      label,
      suite,
    });
    await expect(decryptWithDek(tampered, kek)).rejects.toThrow();
  });

  test(`${label} envelopes reject unsupported metadata and noncanonical or incorrectly sized bytes`, () => {
    const envelope = {
      wrappedKey: "A".repeat(64),
      wrappingMetadata: { suite, iv: "A".repeat(16) },
    };
    const malformed = [
      { ...envelope, wrappingMetadata: undefined },
      { ...envelope, wrappingMetadata: { suite } },
      {
        ...envelope,
        wrappingMetadata: { ...envelope.wrappingMetadata, suite: "test-wrap" },
      },
      {
        ...envelope,
        wrappingMetadata: { ...envelope.wrappingMetadata, extra: true },
      },
      {
        ...envelope,
        wrappingMetadata: { ...envelope.wrappingMetadata, iv: "A".repeat(12) },
      },
      {
        ...envelope,
        wrappingMetadata: {
          ...envelope.wrappingMetadata,
          iv: `${"A".repeat(15)} `,
        },
      },
      { ...envelope, wrappedKey: `${"A".repeat(63)}-` },
      { ...envelope, wrappedKey: bytesToBase64(new Uint8Array(47)) },
      { ...envelope, wrappedKey: bytesToBase64(new Uint8Array(49)) },
      { ...envelope, wrappedKey: `${envelope.wrappedKey}\n` },
    ];
    for (const invalid of malformed) {
      expect(() =>
        decodeContentKeyEnvelope({ envelope: invalid, label, suite }),
      ).toThrow(ContentKeyEnvelopeError);
    }
  });
}
