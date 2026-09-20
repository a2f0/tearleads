import {
  AES_GCM_IV_BYTES,
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";

/** Structurally valid opaque material for tests that do not decrypt it. */
export function contentKeyEnvelopeFixture(
  kind: "Blob" | "Document",
  seed: string,
) {
  // Derived from the seed, not shared: an equality check over envelopes must
  // be able to fail on the metadata alone, not only on the wrapped key.
  const iv = new Bun.CryptoHasher("sha256")
    .update(`iv:${seed}`)
    .digest()
    .subarray(0, AES_GCM_IV_BYTES);
  return {
    wrappedKey: new Bun.CryptoHasher("sha384").update(seed).digest("base64"),
    wrappingMetadata: {
      suite:
        kind === "Blob"
          ? BLOB_CONTENT_KEY_WRAP_SUITE
          : DOCUMENT_CONTENT_KEY_WRAP_SUITE,
      iv: bytesToBase64(iv),
    },
  };
}
