import { expect, test } from "bun:test";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  type ContentKeyEnvelopeKind,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { unwrapContentKeyTargetForKind } from "./projectionContentKeys";

const SEALED = {
  objectId: "document-a",
  contentKeyEpoch: 2,
  containerId: "c1",
  containerKeyEpochId: "e1",
};

async function wrapFor(kind: ContentKeyEnvelopeKind) {
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await wrapContentKey(contentKey, containerKek, {
    kind,
    ...SEALED,
  });
  const suite =
    kind === "Blob"
      ? BLOB_CONTENT_KEY_WRAP_SUITE
      : DOCUMENT_CONTENT_KEY_WRAP_SUITE;
  return {
    containerKek,
    contentKey,
    envelope: {
      containerId: SEALED.containerId,
      containerKeyEpochId: SEALED.containerKeyEpochId,
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrappingMetadata: { suite, iv: bytesToBase64(wrapped.iv) },
    },
  };
}

test("a stored envelope with an unrecognized metadata key still unwraps", async () => {
  const { containerKek, contentKey, envelope } = await wrapFor("Document");
  expect(
    await unwrapContentKeyTargetForKind({
      containerKek,
      contentKeyEpoch: SEALED.contentKeyEpoch,
      envelope: {
        ...envelope,
        wrappingMetadata: {
          ...envelope.wrappingMetadata,
          unrecognized: "written by a newer build",
        },
      },
      kind: "Document",
      objectId: SEALED.objectId,
    }),
  ).toEqual(contentKey);
});

test("an unwrap failure names the target and what was wrong with it", async () => {
  // A blob wrap read as a document one: the caller supplies which target it
  // was, the decoder supplies what was wrong, and neither is dropped.
  const { containerKek, envelope } = await wrapFor("Blob");
  await expect(
    unwrapContentKeyTargetForKind({
      containerKek,
      contentKeyEpoch: SEALED.contentKeyEpoch,
      decryptErrorMessage:
        "Document content-key target for container c1 at epoch e1 could not be unwrapped",
      envelope,
      kind: "Document",
      objectId: SEALED.objectId,
    }),
  ).rejects.toThrow(
    "at epoch e1 could not be unwrapped: Document content-key target uses an unknown suite",
  );
});

test("a wrap served for another document or epoch does not open (#2365, #19)", async () => {
  // A server pairing document A's envelope with document B's bundle, or an
  // older epoch's envelope with a newer bundle, must not yield a key.
  const { containerKek, envelope } = await wrapFor("Document");
  for (const served of [
    { objectId: "document-b", contentKeyEpoch: SEALED.contentKeyEpoch },
    { objectId: SEALED.objectId, contentKeyEpoch: SEALED.contentKeyEpoch + 1 },
  ]) {
    await expect(
      unwrapContentKeyTargetForKind({
        containerKek,
        ...served,
        envelope,
        kind: "Document",
      }),
    ).rejects.toThrow();
  }
});
