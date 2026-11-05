import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  deriveDocumentLinkSetManifest,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { signRegistrationEvent } from "./signing";
import { toWireRecord } from "./wire";

export async function createRootMetadataDocumentRequest(input: {
  containerKey: Uint8Array;
  containerProjection: ContainerWriterProjectionResponse;
  organizationId: string;
  rootMetadataDocumentId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<DocumentCreateRequest> {
  const targetContainerKek = input.containerProjection.containerKeks.at(-1);
  if (!targetContainerKek) {
    throw new Error("Missing root container KEK for metadata document fixture");
  }

  const target: DocumentContentKeyTarget = {
    containerId: targetContainerKek.containerId,
    containerManifestHash: targetContainerKek.accessManifestHash,
    containerKeyEpochId: targetContainerKek.containerKeyEpochId,
    containerKeyEpoch: targetContainerKek.containerKeyEpoch,
  };
  const body: DocumentLinkAccessEventBody = {
    blobRewraps: [],
    eventType: "document.link",
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    dependencyManifestHashes: input.containerProjection.path.map(
      (bundle) => bundle.manifestHash,
    ),
    eventType: "document.link",
    objectKind: "document",
    objectId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [target.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash([target]);
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedContentKey = await wrapContentKey(
    contentKey,
    input.containerKey,
    {
      kind: "Document",
      objectId: input.rootMetadataDocumentId,
      contentKeyEpoch: 1,
      containerId: target.containerId,
      containerKeyEpochId: target.containerKeyEpochId,
    },
  );

  return {
    event: toWireRecord(event, "root metadata document request event"),
    body: toWireRecord(body, "root metadata document request body"),
    expectedManifestHash: manifestHash,
    manifest: toWireRecord(manifest, "root metadata document request manifest"),
    targetContainerPathRefs: input.containerProjection.path.map((bundle) => ({
      containerId: (bundle.state as { containerId: string }).containerId,
      manifestHash: bundle.manifestHash,
    })),
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...target,
          wrappedKey: bytesToBase64(wrappedContentKey.ciphertext),
          wrappingMetadata: {
            suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrappedContentKey.iv),
          },
        },
      ],
    },
  };
}
