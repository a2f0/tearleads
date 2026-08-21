import { expect, test } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@symcrypt/crypto";
import { isDocumentLinkSetMutationRequest } from "@symcrypt/validators/request";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createResponse,
  createSiblingProjection,
  createWrappedProjection,
  fixtureHash,
  getOnlyTarget,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { unwrapDocumentContentKeyTarget } from "../../data/documents/shared/projection";
import { buildMaterializedDocumentCreatePlan } from "./create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("buildMaterializedDocumentLinkSetMutationPlan adds links without rotating and unlinks with a rotated content key", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKek } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-link-set",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };

  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  expect(isDocumentLinkSetMutationRequest(linked.plan.request)).toBe(true);
  expect(linked.contentKeyRotated).toBe(false);
  expect(linked.plan.contentKeyEpoch).toBe(1);
  expect(linked.plan.state.linkedContainerIds).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  expect(linked.plan.targets.map((target) => target.containerId)).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  const siblingEnvelope = linked.plan.request.contentKeyBundle.targets.find(
    (target) => target.containerId === siblingProjection.containerId,
  );
  if (!siblingEnvelope) {
    throw new Error("Expected sibling content-key envelope");
  }
  await expect(
    unwrapDocumentContentKeyTarget({
      containerKek: childContainerKek,
      envelope: siblingEnvelope,
    }),
  ).rejects.toThrow();
  const siblingContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: siblingEnvelope,
  });
  expect(Array.from(siblingContentKey)).toEqual(Array.from(contentKey));

  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const rotatedContentKey = crypto.getRandomValues(new Uint8Array(32));
  const unlinked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    contentKey: rotatedContentKey,
    operation: "unlink",
    signedAt: "2026-04-27T00:00:01.000Z",
    targetContainerProjection: projection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection: {
      authorizingContainerPaths: [projection, siblingProjection],
      contentKeyBundle: linkResponse.contentKeyBundle,
      ...writerProjectionEvidence(
        [projection, siblingProjection],
        [createdResponse.accessManifest],
      ),
      documentId: linkResponse.id,
      documentKekTargets: linkResponse.documentKekTargets,
      documentManifest: linkResponse.accessManifest,
    },
  });

  expect(unlinked.contentKeyRotated).toBe(true);
  expect(unlinked.plan.contentKeyEpoch).toBe(2);
  expect(unlinked.plan.state.linkedContainerIds).toEqual([
    siblingProjection.containerId,
  ]);
  expect(unlinked.plan.targets.map((target) => target.containerId)).toEqual([
    siblingProjection.containerId,
  ]);
  const [remainingEnvelope] = unlinked.plan.request.contentKeyBundle.targets;
  if (!remainingEnvelope) {
    throw new Error("Expected remaining content-key envelope");
  }
  const remainingContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: siblingContainerKek,
    envelope: remainingEnvelope,
  });
  expect(Array.from(remainingContentKey)).toEqual(
    Array.from(rotatedContentKey),
  );
});

test("buildMaterializedDocumentLinkSetMutationPlan rejects split writer projection target hashes", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection } = await createSiblingProjection({
    baseProjection: projection,
    rootContainerKek,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-link-set-split-projection",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const splitTargetHash = await fixtureHash("split-writer-projection-target");

  await expect(
    buildMaterializedDocumentLinkSetMutationPlan({
      author,
      operation: "link",
      targetContainerProjection: siblingProjection,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [projection],
        contentKeyBundle: {
          ...createdResponse.contentKeyBundle,
          targetHash: splitTargetHash,
        },
        ...writerProjectionEvidence([projection], []),
        documentId: createdResponse.id,
        documentKekTargets: {
          ...createdResponse.documentKekTargets,
          documentKeyTargetHash: splitTargetHash,
        },
        documentManifest: createdResponse.accessManifest,
      },
    }),
  ).rejects.toThrow("writer projection target hash is not canonical");
});

test("buildMaterializedDocumentSyncPlan rejects authorizing paths outside the document targets", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection } = await createSiblingProjection({
    baseProjection: projection,
    rootContainerKek,
  });
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-sync-forged-authorization-path",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const childTarget = getOnlyTarget(projection);
  const siblingEnvelope = linked.plan.request.contentKeyBundle.targets.find(
    (target) => target.containerId === siblingProjection.containerId,
  );
  if (!siblingEnvelope) {
    throw new Error("Expected sibling content-key envelope fixture");
  }

  const forgedEnvelope = {
    ...siblingEnvelope,
    containerId: childTarget.containerId,
    containerManifestHash: childTarget.containerManifestHash,
  };
  const forgedTarget = {
    containerId: forgedEnvelope.containerId,
    containerManifestHash: forgedEnvelope.containerManifestHash,
    containerKeyEpochId: forgedEnvelope.containerKeyEpochId,
    containerKeyEpoch: forgedEnvelope.containerKeyEpoch,
  };
  const forgedTargetHash = await computeDocumentContentKeyTargetHash([
    forgedTarget,
  ]);

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      pendingUpdates: [createPendingUpdateRecord()],
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [siblingProjection],
        contentKeyBundle: {
          ...createdResponse.contentKeyBundle,
          targetHash: forgedTargetHash,
          targets: [forgedEnvelope],
        },
        ...writerProjectionEvidence([projection], []),
        documentId: createdResponse.id,
        documentKekTargets: {
          ...createdResponse.documentKekTargets,
          documentKeyTargetHash: forgedTargetHash,
          linkedContainerKeyEpochIds: [forgedTarget.containerKeyEpochId],
          linkedContainerManifestHashes: [forgedTarget.containerManifestHash],
          targets: [forgedTarget],
        },
        documentManifest: createdResponse.accessManifest,
      },
    }),
  ).rejects.toThrow("authorization path[0] is not a document target");
});

test("buildMaterializedDocumentSyncPlan names malformed authorizing path indexes", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const sourceProjection = writerProjection.authorizingContainerPaths[0];
  if (!sourceProjection) {
    throw new Error("Expected authorizing path fixture");
  }
  const leafIndex = sourceProjection.path.length - 1;
  const malformedProjection: typeof sourceProjection = {
    ...sourceProjection,
    path: sourceProjection.path.map((bundle, index) =>
      index === leafIndex
        ? {
            ...bundle,
            state: {
              ...bundle.state,
              containerId: "wrong-authorizing-path-container",
            },
          }
        : bundle,
    ),
  };

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      localVersionVector: null,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        ...writerProjection,
        authorizingContainerPaths: [malformedProjection],
      },
    }),
  ).rejects.toThrow(
    "authorization path[0] is invalid: Container writer projection target path is inconsistent",
  );
});

test("buildMaterializedDocumentLinkSetMutationPlan names inaccessible remaining KEKs during unlink", async () => {
  const { author } = await createAuthor();
  const { projection, rootContainerKek, secretKey } =
    await createWrappedProjection();
  const { projection: siblingProjection, siblingContainerKeyEpochId } =
    await createSiblingProjection({
      baseProjection: projection,
      rootContainerKek,
    });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-link-set-missing-kek",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    ...writerProjectionEvidence([projection], []),
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    targetContainerProjection: siblingProjection,
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    writerProjection.documentId,
    linked.plan.request,
  );
  const inaccessibleSiblingProjection: typeof siblingProjection = {
    ...siblingProjection,
    containerKeks: siblingProjection.containerKeks.map((kek, index) =>
      index === siblingProjection.containerKeks.length - 1
        ? { ...kek, wraps: [] }
        : kek,
    ),
  };

  await expect(
    buildMaterializedDocumentLinkSetMutationPlan({
      author,
      operation: "unlink",
      targetContainerProjection: projection,
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection: {
        authorizingContainerPaths: [projection, inaccessibleSiblingProjection],
        contentKeyBundle: linkResponse.contentKeyBundle,
        ...writerProjectionEvidence(
          [projection, inaccessibleSiblingProjection],
          [createdResponse.accessManifest],
        ),
        documentId: linkResponse.id,
        documentKekTargets: linkResponse.documentKekTargets,
        documentManifest: linkResponse.accessManifest,
      },
    }),
  ).rejects.toThrow(
    `container ${siblingProjection.containerId} epoch ${siblingContainerKeyEpochId}`,
  );
});
