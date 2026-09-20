import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "@tearleads/crypto";

/** Structurally valid opaque material for tests that do not decrypt it. */
export function contentKeyEnvelopeFixture(
  kind: "Blob" | "Document",
  seed: string,
) {
  return {
    wrappedKey: new Bun.CryptoHasher("sha384").update(seed).digest("base64"),
    wrappingMetadata: {
      suite:
        kind === "Blob"
          ? BLOB_CONTENT_KEY_WRAP_SUITE
          : DOCUMENT_CONTENT_KEY_WRAP_SUITE,
      iv: "AAAAAAAAAAAAAAAA",
    },
  };
}
