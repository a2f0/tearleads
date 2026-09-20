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
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  decryptWithDek,
  encryptWithDek,
} from "./symmetric";

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
        decodeContentKeyEnvelope({
          envelope,
          label,
          origin: "submission",
          suite,
        }),
        kek,
      ),
    ).toEqual(key);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 1;
    const tampered = decodeContentKeyEnvelope({
      origin: "submission",
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
        decodeContentKeyEnvelope({
          envelope: invalid,
          label,
          origin: "submission",
          suite,
        }),
      ).toThrow(ContentKeyEnvelopeError);
    }
  });
}

test("a stored envelope with extra metadata still decodes", () => {
  const suite = DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  const iv = bytesToBase64(new Uint8Array(AES_GCM_IV_BYTES));
  const wrappedKey = bytesToBase64(new Uint8Array(32 + AES_GCM_TAG_BYTES));
  const envelope = {
    wrappedKey,
    wrappingMetadata: { iv, suite, unexpected: "written by another build" },
  };
  // Submitting it is refused: the published shape is exactly suite and iv.
  expect(() =>
    decodeContentKeyEnvelope({
      envelope,
      label: "Document",
      origin: "submission",
      suite,
    }),
  ).toThrow(ContentKeyEnvelopeError);
  // Reading it is not, or the row would be permanently undecryptable even
  // though the AEAD tag can still authenticate it.
  const decoded = decodeContentKeyEnvelope({
    envelope,
    label: "Document",
    origin: "stored",
    suite,
  });
  expect(decoded.iv).toHaveLength(AES_GCM_IV_BYTES);
  expect(decoded.ciphertext).toHaveLength(32 + AES_GCM_TAG_BYTES);
});

test("a stored envelope for the other object kind is refused", () => {
  const iv = bytesToBase64(new Uint8Array(AES_GCM_IV_BYTES));
  const wrappedKey = bytesToBase64(new Uint8Array(32 + AES_GCM_TAG_BYTES));
  // Blob and document wraps are sealed to the same container KEK with no AAD,
  // and the target hash covers neither the wrapped key nor its metadata, so the
  // suite label is all that ties an envelope to its object kind. Reading must
  // enforce it, or a server can serve a document wrap inside a blob bundle.
  const documentEnvelope = {
    wrappedKey,
    wrappingMetadata: { iv, suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE },
  };
  for (const origin of ["stored", "submission"] as const) {
    expect(() =>
      decodeContentKeyEnvelope({
        envelope: documentEnvelope,
        label: "Blob",
        origin,
        suite: BLOB_CONTENT_KEY_WRAP_SUITE,
      }),
    ).toThrow(ContentKeyEnvelopeError);
  }
  // The matching kind still decodes under both.
  for (const origin of ["stored", "submission"] as const) {
    expect(
      decodeContentKeyEnvelope({
        envelope: documentEnvelope,
        label: "Document",
        origin,
        suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
      }).iv,
    ).toHaveLength(AES_GCM_IV_BYTES);
  }
});
