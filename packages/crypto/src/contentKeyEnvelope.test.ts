import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  ContentKeyEnvelopeError,
  type ContentKeyWrapBinding,
  decodeContentKeyEnvelope,
  unwrapContentKey,
  wrapContentKey,
} from "./contentKeyEnvelope";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "./keying/types";
import { AES_GCM_IV_BYTES, AES_GCM_TAG_BYTES } from "./symmetric";

for (const kind of ["Blob", "Document"] as const) {
  const suite =
    kind === "Blob"
      ? BLOB_CONTENT_KEY_WRAP_SUITE
      : DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  test(`${kind} envelopes accept genuine wraps and still require authenticated decryption`, async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32));
    const key = crypto.getRandomValues(new Uint8Array(32));
    const binding: ContentKeyWrapBinding = {
      kind,
      objectId: "object-1",
      contentKeyEpoch: 1,
      containerId: "container-1",
      containerKeyEpochId: "epoch-1",
    };
    const encrypted = await wrapContentKey(key, kek, binding);
    const envelope = {
      wrappedKey: bytesToBase64(encrypted.ciphertext),
      wrappingMetadata: { suite, iv: bytesToBase64(encrypted.iv) },
    };
    expect(
      await unwrapContentKey(
        decodeContentKeyEnvelope({
          envelope,
          kind,
          origin: "submission",
        }),
        kek,
        binding,
      ),
    ).toEqual(key);
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 1;
    const tampered = decodeContentKeyEnvelope({
      origin: "submission",
      envelope: {
        ...envelope,
        wrappedKey: bytesToBase64(encrypted.ciphertext),
      },
      kind,
    });
    await expect(unwrapContentKey(tampered, kek, binding)).rejects.toThrow();
  });

  test(`${kind} envelopes reject unsupported metadata and noncanonical or incorrectly sized bytes`, () => {
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
          kind,
          origin: "submission",
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
      kind: "Document",
      origin: "submission",
    }),
  ).toThrow(ContentKeyEnvelopeError);
  // Reading it is not, or the row would be permanently undecryptable even
  // though the AEAD tag can still authenticate it.
  const decoded = decodeContentKeyEnvelope({
    envelope,
    kind: "Document",
    origin: "stored",
  });
  expect(decoded.iv).toHaveLength(AES_GCM_IV_BYTES);
  expect(decoded.ciphertext).toHaveLength(32 + AES_GCM_TAG_BYTES);
});

test("a stored envelope for the other object kind is refused", () => {
  const iv = bytesToBase64(new Uint8Array(AES_GCM_IV_BYTES));
  const wrappedKey = bytesToBase64(new Uint8Array(32 + AES_GCM_TAG_BYTES));
  // Blob and document wraps are sealed to the same container KEK, and the
  // target hash covers neither the wrapped key nor its metadata. The wrap's
  // authenticated data binds the kind too; decoding enforces the suite label
  // first so a mismatched envelope fails with a structural diagnostic.
  const documentEnvelope = {
    wrappedKey,
    wrappingMetadata: { iv, suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE },
  };
  for (const origin of ["stored", "submission"] as const) {
    expect(() =>
      decodeContentKeyEnvelope({
        envelope: documentEnvelope,
        kind: "Blob",
        origin,
      }),
    ).toThrow(ContentKeyEnvelopeError);
  }
  // The matching kind still decodes under both.
  for (const origin of ["stored", "submission"] as const) {
    expect(
      decodeContentKeyEnvelope({
        envelope: documentEnvelope,
        kind: "Document",
        origin,
      }).iv,
    ).toHaveLength(AES_GCM_IV_BYTES);
  }
});

test("a stored envelope without plain-object wrap metadata is refused", () => {
  const iv = bytesToBase64(new Uint8Array(AES_GCM_IV_BYTES));
  const wrappedKey = bytesToBase64(new Uint8Array(32 + AES_GCM_TAG_BYTES));
  const suite = DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  // An array is `typeof "object"`, so the diagnostic has to come from a plain
  // object check rather than from the later suite or IV lookups reading
  // undefined and reporting something unrelated.
  for (const wrappingMetadata of [
    undefined,
    null,
    "suite=document",
    [{ iv, suite }],
  ]) {
    expect(() =>
      decodeContentKeyEnvelope({
        envelope: { wrappedKey, wrappingMetadata },
        kind: "Document",
        origin: "stored",
      }),
    ).toThrow("Document content-key target is missing wrap metadata");
  }
});

test("a stored envelope with malformed bytes is refused", () => {
  const suite = DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  const iv = bytesToBase64(new Uint8Array(AES_GCM_IV_BYTES));
  const wrappedKey = bytesToBase64(new Uint8Array(32 + AES_GCM_TAG_BYTES));
  // `stored` is lenient about an unrecognized metadata key, not about the
  // bytes: the sizes are fixed by the suite, and a retained wrap is recognized
  // by comparing its wrapped key as a string, so the encoding must be
  // canonical for that comparison to mean comparing the bytes.
  const malformed = [
    {
      wrappedKey,
      wrappingMetadata: { iv: bytesToBase64(new Uint8Array(11)), suite },
    },
    {
      wrappedKey: bytesToBase64(new Uint8Array(49)),
      wrappingMetadata: { iv, suite },
    },
    {
      wrappedKey: `${wrappedKey.slice(0, 63)}-`,
      wrappingMetadata: { iv, suite },
    },
  ];
  for (const envelope of malformed) {
    expect(() =>
      decodeContentKeyEnvelope({
        envelope,
        kind: "Document",
        origin: "stored",
      }),
    ).toThrow(ContentKeyEnvelopeError);
  }
  // Reachable only under `stored`: a submission's exact-keys check accepts
  // this key set, so the IV's type is what has to reject it. The diagnostic
  // is pinned because a wrong-typed IV also trips the length check below it.
  expect(() =>
    decodeContentKeyEnvelope({
      envelope: {
        wrappedKey,
        wrappingMetadata: { iv: AES_GCM_IV_BYTES, suite },
      },
      kind: "Document",
      origin: "stored",
    }),
  ).toThrow("Document content-key target is missing an IV");
});

test("a content-key wrap opens only for the binding it was sealed to (#2365, #19)", async () => {
  const kek = crypto.getRandomValues(new Uint8Array(32));
  const key = crypto.getRandomValues(new Uint8Array(32));
  const sealed: ContentKeyWrapBinding = {
    kind: "Document",
    objectId: "document-a",
    contentKeyEpoch: 3,
    containerId: "container-1",
    containerKeyEpochId: "epoch-1",
  };
  const wrapped = await wrapContentKey(key, kek, sealed);
  expect(await unwrapContentKey(wrapped, kek, sealed)).toEqual(key);
  // A server serving this wrap in another document's bundle, at another
  // content-key epoch or target, or as a blob's key gets nothing.
  for (const served of [
    { ...sealed, objectId: "document-b" },
    { ...sealed, contentKeyEpoch: 4 },
    { ...sealed, containerId: "container-2" },
    { ...sealed, containerKeyEpochId: "epoch-2" },
    { ...sealed, kind: "Blob" as const },
  ]) {
    await expect(unwrapContentKey(wrapped, kek, served)).rejects.toThrow();
  }
});
