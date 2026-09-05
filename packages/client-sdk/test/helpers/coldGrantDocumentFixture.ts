import {
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  encryptWithDek,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import type {
  ContainerWriterProjectionResponse,
  DocumentContentKeyBundleResponse,
  DocumentSyncResponse,
} from "@tearleads/validators/response";
import { prepareDocumentOutgoingUpdates } from "../../src/workflows/documents/syncContentKeys";
import { signDocumentOutgoingUpdate } from "../../src/workflows/documents/syncPlanIdentity";
import {
  type createAuthor,
  createPendingUpdateRecord,
  fixtureHash,
} from "./documentFixtures";
import type { rotateRootKekKeyringFixture } from "./keyringRotationFixtures";

type ProjectionKek = ContainerWriterProjectionResponse["containerKeks"][number];

export const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440090";
export const ORGANIZATION_ID = "organization-1";
export const USER_ID = "user-1";

export function rootOnlyProjection(
  rotated: Awaited<ReturnType<typeof rotateRootKekKeyringFixture>>,
  wraps: ProjectionKek["wraps"],
): ContainerWriterProjectionResponse {
  return {
    ...rotated.fixture.projection,
    containerId: rotated.successor.containerId,
    containerKeks: [{ ...rotated.successor, wraps }],
    path: [rotated.currentManifest],
  };
}

async function createContentKeyBundle(input: {
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  containerManifestHash: string;
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  linkSetManifestHash: string;
}): Promise<DocumentContentKeyBundleResponse> {
  const target = {
    containerId: input.containerId,
    containerKeyEpoch: input.containerKeyEpoch,
    containerKeyEpochId: input.containerKeyEpochId,
    containerManifestHash: input.containerManifestHash,
  };
  const wrapped = await encryptWithDek(input.contentKey, input.containerKey);

  return {
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: input.linkSetManifestHash,
    targetHash: await computeDocumentContentKeyTargetHash([target]),
    targets: [
      {
        ...target,
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrappingMetadata: {
          suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
          iv: bytesToBase64(wrapped.iv),
        },
      },
    ],
  };
}

async function createDocumentEpochUpdate(input: {
  author: Awaited<ReturnType<typeof createAuthor>>["author"];
  bundle: DocumentContentKeyBundleResponse;
  contentKey: Uint8Array;
  id: string;
  updateData: Uint8Array;
}) {
  const vectors = getUpdateVersionVectors(input.updateData);
  const [prepared] = await prepareDocumentOutgoingUpdates({
    contentKey: input.contentKey,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    organizationId: ORGANIZATION_ID,
    pendingUpdates: [
      createPendingUpdateRecord({
        id: input.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        updateData: bytesToBase64(input.updateData),
      }),
    ],
  });
  if (!prepared) {
    throw new Error("Expected prepared document update");
  }

  const signed = await signDocumentOutgoingUpdate({
    author: input.author,
    contentKeyEpoch: input.bundle.contentKeyEpoch,
    documentId: DOCUMENT_ID,
    expectedLinkSetManifestHash: input.bundle.linkSetManifestHash,
    expectedTargetHash: input.bundle.targetHash,
    organizationId: ORGANIZATION_ID,
    signedAt: "2026-08-12T12:00:00.000Z",
    update: prepared,
  });
  return {
    ...signed,
    authorizationTargets: input.bundle.targets.map((target) => ({
      containerId: target.containerId,
      containerKeyEpoch: target.containerKeyEpoch,
      containerKeyEpochId: target.containerKeyEpochId,
      containerManifestHash: target.containerManifestHash,
    })),
  };
}

function syncResponseUpdate(
  update: Awaited<ReturnType<typeof createDocumentEpochUpdate>>,
): DocumentSyncResponse["updates"][number] {
  return {
    authorizationTargets: update.authorizationTargets,
    accessEpoch: 1,
    authorFingerprint: String(
      Reflect.get(update.writeHeader, "writerKeyFingerprint"),
    ),
    createdAt: "2026-08-12T12:00:00.000Z",
    documentId: DOCUMENT_ID,
    encryptedData: update.encryptedData,
    id: update.id,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    writeHeader: update.writeHeader,
  };
}

export async function createMultiEpochDocumentFixture(input: {
  author: Awaited<ReturnType<typeof createAuthor>>["author"];
  rotated: Awaited<ReturnType<typeof rotateRootKekKeyringFixture>>;
}) {
  const source = await createDocument("cold-grant-source");
  source.getText("text").update("before container rotation");
  source.commit();
  const historicalUpdate = exportUpdatesSince(source);
  const historicalFrontier = encodeVersionVector(source);
  source.getText("text").update("after container rotation");
  source.commit();
  const currentUpdate = exportUpdatesSince(source, historicalFrontier);
  const linkSetManifestHash = await fixtureHash("cold-grant-link-set");
  const historicalContentKey = crypto.getRandomValues(new Uint8Array(32));
  const currentContentKey = crypto.getRandomValues(new Uint8Array(32));
  const historicalBundle = await createContentKeyBundle({
    containerId: input.rotated.successor.containerId,
    containerKey: input.rotated.fixture.rootContainerKek,
    containerKeyEpoch: 1,
    containerKeyEpochId: input.rotated.predecessorEpochId,
    containerManifestHash: input.rotated.successor.accessManifestHash,
    contentKey: historicalContentKey,
    contentKeyEpoch: 1,
    linkSetManifestHash,
  });
  const currentBundle = await createContentKeyBundle({
    containerId: input.rotated.successor.containerId,
    containerKey: input.rotated.currentKey,
    containerKeyEpoch: input.rotated.successor.containerKeyEpoch,
    containerKeyEpochId: input.rotated.currentEpochId,
    containerManifestHash: input.rotated.successor.accessManifestHash,
    contentKey: currentContentKey,
    contentKeyEpoch: 2,
    linkSetManifestHash,
  });
  const updates = await Promise.all([
    createDocumentEpochUpdate({
      author: input.author,
      bundle: historicalBundle,
      contentKey: historicalContentKey,
      id: "550e8400-e29b-41d4-a716-446655440091",
      updateData: historicalUpdate,
    }),
    createDocumentEpochUpdate({
      author: input.author,
      bundle: currentBundle,
      contentKey: currentContentKey,
      id: "550e8400-e29b-41d4-a716-446655440092",
      updateData: currentUpdate,
    }),
  ]);
  const currentTarget = currentBundle.targets[0];
  if (!currentTarget) {
    throw new Error("Expected current document target");
  }

  return {
    response: {
      acceptedOutgoingUpdateIds: [],
      commitLsn: "0/16B6C50",
      commitLsnMode: "tracked",
      contentKeyBundle: currentBundle,
      contentKeyBundles: [historicalBundle],
      documentId: DOCUMENT_ID,
      documentKekTargets: {
        documentId: DOCUMENT_ID,
        documentKeyTargetHash: currentBundle.targetHash,
        linkedContainerKeyEpochIds: [currentTarget.containerKeyEpochId],
        linkedContainerManifestHashes: [currentTarget.containerManifestHash],
        linkSetManifestHash,
        targets: [
          {
            containerId: currentTarget.containerId,
            containerKeyEpoch: currentTarget.containerKeyEpoch,
            containerKeyEpochId: currentTarget.containerKeyEpochId,
            containerManifestHash: currentTarget.containerManifestHash,
          },
        ],
      },
      pullPage: { hasMore: false, nextCursor: null },
      updates: updates.map(syncResponseUpdate),
    } satisfies DocumentSyncResponse,
  };
}
