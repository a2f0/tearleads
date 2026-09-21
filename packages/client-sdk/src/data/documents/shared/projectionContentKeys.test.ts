import { expect, test } from "bun:test";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { unwrapContentKeyTargetForKind } from "./projectionContentKeys";

async function wrapFor(suite: string) {
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await encryptWithDek(contentKey, containerKek);
  return {
    containerKek,
    contentKey,
    envelope: {
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: { suite, iv: bytesToBase64(wrapped.iv) },
    },
  };
}

test("a stored envelope with an unrecognized metadata key still unwraps", async () => {
  const { containerKek, contentKey, envelope } = await wrapFor(
    DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  );
  expect(
    await unwrapContentKeyTargetForKind({
      containerKek,
      envelope: {
        ...envelope,
        wrappingMetadata: {
          ...envelope.wrappingMetadata,
          unrecognized: "written by a newer build",
        },
      },
      kind: "Document",
    }),
  ).toEqual(contentKey);
});

test("an unwrap failure names the target and what was wrong with it", async () => {
  // A blob wrap read as a document one: the caller supplies which target it
  // was, the decoder supplies what was wrong, and neither is dropped.
  const { containerKek, envelope } = await wrapFor(BLOB_CONTENT_KEY_WRAP_SUITE);
  await expect(
    unwrapContentKeyTargetForKind({
      containerKek,
      decryptErrorMessage:
        "Document content-key target for container c1 at epoch e1 could not be unwrapped",
      envelope,
      kind: "Document",
    }),
  ).rejects.toThrow(
    "at epoch e1 could not be unwrapped: Document content-key target uses an unknown suite",
  );
});
