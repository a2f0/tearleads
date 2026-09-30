import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
} from "@tearleads/validators/response";
import { unwrapContainerKekPath } from "../../src/data/documents/shared/containerKekPath";

/**
 * A document content-key bundle sealed for another content-key epoch or key.
 * Each wrap binds its document and epoch, so a fixture cannot relabel an
 * existing bundle's epoch and still expect it to open.
 */
export async function sealContentKeyBundle(input: {
  bundle: DocumentContentKeyBundleResponse;
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
}): Promise<DocumentContentKeyBundleResponse> {
  const keks = await unwrapContainerKekPath({
    projection: input.projection,
    secretKey: input.secretKey,
    trustedLocalProjection: true,
  });
  const targets = await Promise.all(
    input.bundle.targets.map(async (target) => {
      const kek = keks.get(target.containerKeyEpochId);
      if (!kek) throw new Error("Fixture target KEK is unavailable");
      const wrapped = await wrapContentKey(input.contentKey, kek, {
        kind: "Document",
        objectId: input.bundle.documentId,
        contentKeyEpoch: input.contentKeyEpoch,
        containerId: target.containerId,
        containerKeyEpochId: target.containerKeyEpochId,
      });
      return {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      };
    }),
  );
  return { ...input.bundle, contentKeyEpoch: input.contentKeyEpoch, targets };
}

/** A materialized fixture's content key sealed again at its next epoch. */
export function sealNextContentKeyEpoch(fixture: {
  contentKey: Uint8Array;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
  writerProjection: { contentKeyBundle: DocumentContentKeyBundleResponse };
}): Promise<DocumentContentKeyBundleResponse> {
  const bundle = fixture.writerProjection.contentKeyBundle;
  return sealContentKeyBundle({
    bundle,
    contentKey: fixture.contentKey,
    contentKeyEpoch: bundle.contentKeyEpoch + 1,
    projection: fixture.projection,
    secretKey: fixture.secretKey,
  });
}
