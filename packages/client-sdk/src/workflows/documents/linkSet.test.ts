import { expect, test } from "bun:test";
import { buildMaterializedDocumentCreatePlan } from "@tearleads/client-sdk/workflows/documents/create";
import {
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "@tearleads/client-sdk/workflows/documents/linkSet";
import { buildMaterializedDocumentSyncPlan } from "@tearleads/client-sdk/workflows/documents/sync";
import {
  type AccessEvent,
  computeDocumentContentKeyTargetHash,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import {
  type DocumentLinkSetMutationRequest,
  isDocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
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
} from "../../../test/helpers/documentFixtures";
import { unwrapDocumentContentKeyTarget } from "../../data/documents/shared/projection";
import { persistedDocumentLinkSetMutationStateFromResponse } from "../../data/documents/shared/responses";

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
        documentId: linkResponse.id,
        documentKekTargets: linkResponse.documentKekTargets,
        documentManifest: linkResponse.accessManifest,
      },
    }),
  ).rejects.toThrow(
    `container ${siblingProjection.containerId} epoch ${siblingContainerKeyEpochId}`,
  );
});

test("relinkRemoteDocument submits a verified signed link-set mutation", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "remote-link-root-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const siblingProjection = await createContainerWriterProjectionFixture({
    containerId: "remote-link-sibling-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: projection,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: keyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-link",
    resolveProjectionUserKey,
    targetSecretKey: keyPair.secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const writerProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const submittedRequests: DocumentLinkSetMutationRequest[] = [];

  const linked = await relinkRemoteDocument({
    apiClient: {
      getContainerWriterProjection: async (containerId) =>
        containerId === siblingProjection.containerId
          ? siblingProjection
          : null,
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      linkDocument: async (documentId, request) => {
        submittedRequests.push(request);
        return createLinkSetResponseFromRequest(documentId, request);
      },
      unlinkDocument: async () => {
        throw new Error("Unexpected unlink call");
      },
    },
    author,
    documentId: writerProjection.documentId,
    operation: "link",
    resolveProjectionUserKey,
    targetContainerId: siblingProjection.containerId,
    targetSecretKey: keyPair.secretKey,
  });

  expect(submittedRequests).toHaveLength(1);
  expect(linked?.contentKeyRotated).toBe(false);
  expect(linked?.linkedContainerIds).toEqual(
    [projection.containerId, siblingProjection.containerId].sort(),
  );
  if (!linked) {
    throw new Error("Expected remote link result");
  }
  expect(
    persistedDocumentLinkSetMutationStateFromResponse(
      linked.plan,
      linked.response,
    ),
  ).toEqual(linked.persistedState);
});

test("relinkRemoteDocument rejects bad unlink target container signatures before sending", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "remote-unlink-root-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const siblingProjection = await createContainerWriterProjectionFixture({
    containerId: "remote-unlink-sibling-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    parentProjection: projection,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: keyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-unlink",
    resolveProjectionUserKey,
    targetSecretKey: keyPair.secretKey,
  });
  const createdResponse = createResponse(created.plan);
  const initialWriterProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection],
    contentKeyBundle: createdResponse.contentKeyBundle,
    documentId: createdResponse.id,
    documentKekTargets: createdResponse.documentKekTargets,
    documentManifest: createdResponse.accessManifest,
  };
  const linked = await buildMaterializedDocumentLinkSetMutationPlan({
    author,
    operation: "link",
    resolveProjectionUserKey,
    targetContainerProjection: siblingProjection,
    targetSecretKey: keyPair.secretKey,
    writerProjection: initialWriterProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    initialWriterProjection.documentId,
    linked.plan.request,
  );
  const linkedWriterProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection, siblingProjection],
    contentKeyBundle: linkResponse.contentKeyBundle,
    documentId: linkResponse.id,
    documentKekTargets: linkResponse.documentKekTargets,
    documentManifest: linkResponse.accessManifest,
    documentManifestHistory: [initialWriterProjection.documentManifest],
  };
  const tamperedTargetProjection = structuredClone(projection);
  const signedEvent = tamperedTargetProjection.path[0]?.event
    .event as unknown as AccessEvent;
  const signature = signedEvent.signature;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed target container event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  let unlinkCalled = false;

  await expect(
    relinkRemoteDocument({
      apiClient: {
        getContainerWriterProjection: async (containerId) =>
          containerId === projection.containerId
            ? tamperedTargetProjection
            : null,
        getDocumentWriterProjection: async (documentId) =>
          documentId === linkedWriterProjection.documentId
            ? linkedWriterProjection
            : null,
        linkDocument: async () => {
          throw new Error("Unexpected link call");
        },
        unlinkDocument: async () => {
          unlinkCalled = true;
          throw new Error("Unexpected unlink call");
        },
      },
      author,
      documentId: linkedWriterProjection.documentId,
      operation: "unlink",
      resolveProjectionUserKey,
      targetContainerId: projection.containerId,
      targetSecretKey: keyPair.secretKey,
    }),
  ).rejects.toThrow(
    "Document link-set target container projection verification failed",
  );
  expect(unlinkCalled).toBe(false);
});
