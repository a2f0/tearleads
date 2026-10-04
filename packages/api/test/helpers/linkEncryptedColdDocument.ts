import type { ApiClient } from "@tearleads/api-client";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "@tearleads/client-sdk";
import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentLinkAccessEventBody,
  deriveDocumentLinkSetManifest,
  wrapContentKey,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { createAncestorSdkContext } from "./ancestorSdkRepair";
import { createSignedAccessEvent } from "./keyingWriterProjectionKit";

/** A real, signed second link with the same DEK wrapped to a distinct target KEK. */
export async function linkEncryptedColdDocument(input: {
  apiClient: ApiClient;
  context: Awaited<ReturnType<typeof createAncestorSdkContext>>;
  documentId: string;
  owner: TestUser;
  targetContainerId: string;
}): Promise<void> {
  const projection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  const target = await input.apiClient.getContainerWriterProjection(
    input.targetContainerId,
  );
  const source = projection?.authorizingContainerPaths[0];
  const sourceEnvelope = projection?.contentKeyBundle.targets.find(
    (envelope) => envelope.containerId === source?.containerId,
  );
  const targetHead = target?.path.at(-1);
  const targetKek = target?.containerKeks.at(-1);
  if (
    !projection ||
    !source ||
    !sourceEnvelope ||
    !target ||
    !targetHead ||
    !targetKek
  )
    throw new Error("Expected link projections");
  const unwrapInput = {
    ...input.context.common,
    secretKey: input.owner.kem.secretKey,
  };
  const sourceKeys = await unwrapContainerKekPath({
    ...unwrapInput,
    projection: { ...source, policyEvidence: projection.policyEvidence },
  });
  const targetKeys = await unwrapContainerKekPath({
    ...unwrapInput,
    projection: target,
  });
  const sourceKey = sourceKeys.get(sourceEnvelope.containerKeyEpochId);
  const targetKey = targetKeys.get(targetKek.containerKeyEpochId);
  if (!sourceKey || !targetKey) throw new Error("Expected link KEKs");
  const contentKeyEpoch = projection.contentKeyBundle.contentKeyEpoch;
  const contentKey = await unwrapDocumentContentKeyTarget({
    containerKek: sourceKey,
    contentKeyEpoch,
    documentId: input.documentId,
    envelope: sourceEnvelope,
  });
  const wrapped = await wrapContentKey(contentKey, targetKey, {
    kind: "Document",
    objectId: input.documentId,
    contentKeyEpoch,
    containerId: input.targetContainerId,
    containerKeyEpochId: targetKek.containerKeyEpochId,
  });
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: input.targetContainerId,
    containerManifestHash: targetHead.manifestHash,
    blobRewraps: [],
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...source.path, ...target.path].map((bundle) => bundle.manifestHash),
      ),
    ],
    objectId: input.documentId,
    objectKind: "document",
    organizationId: input.context.common.author.organizationId,
    previousManifestHash: projection.documentManifest.manifestHash,
    signer: input.owner,
  });
  const manifest = await deriveDocumentLinkSetManifest({
    version: 1,
    documentId: input.documentId,
    organizationId: input.context.common.author.organizationId,
    epoch: Number(Reflect.get(projection.documentManifest.state, "epoch")) + 1,
    previousManifestHash: projection.documentManifest.manifestHash,
    eventHash: event.eventHash,
    linkedContainerIds: [
      ...projection.contentKeyBundle.targets.map((entry) => entry.containerId),
      input.targetContainerId,
    ],
  });
  const manifestHash = await computeAccessManifestHash(manifest);
  const nextTarget = {
    containerId: input.targetContainerId,
    containerManifestHash: targetHead.manifestHash,
    containerKeyEpoch: targetKek.containerKeyEpoch,
    containerKeyEpochId: targetKek.containerKeyEpochId,
  };
  const targetHash = await computeDocumentContentKeyTargetHash([
    ...projection.contentKeyBundle.targets.map((entry) => ({
      containerId: entry.containerId,
      containerManifestHash: entry.containerManifestHash,
      containerKeyEpoch: entry.containerKeyEpoch,
      containerKeyEpochId: entry.containerKeyEpochId,
    })),
    nextTarget,
  ]);
  const result = await input.apiClient.linkDocumentResult(input.documentId, {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    authorizingContainerPathRefs: [
      source.path.map((bundle) => ({
        containerId: String(Reflect.get(bundle.state, "containerId")),
        manifestHash: bundle.manifestHash,
      })),
    ],
    targetContainerPathRefs: target.path.map((bundle) => ({
      containerId: String(Reflect.get(bundle.state, "containerId")),
      manifestHash: bundle.manifestHash,
    })),
    contentKeyBundle: {
      contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        ...projection.contentKeyBundle.targets,
        {
          ...nextTarget,
          wrappedKey: bytesToBase64(wrapped.ciphertext),
          wrappingMetadata: {
            suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrapped.iv),
          },
        },
      ],
    },
  });
  if (!result.ok) throw new Error(result.message);
}
