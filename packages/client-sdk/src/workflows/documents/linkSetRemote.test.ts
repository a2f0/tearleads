import { expect, test } from "bun:test";
import { type AccessEvent, generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { persistedDocumentLinkSetMutationStateFromResponse } from "../../data/documents/shared/responses";
import { buildMaterializedDocumentCreatePlan } from "./create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
import { relinkRemoteDocument } from "./linkSetRemote";

test("relinkRemoteDocument rejects unlink without reading projections when its rotation snapshot is missing", async () => {
  const { author } = await createAuthor();
  let projectionReads = 0;
  const { close, execSql } = await createTestExecSql("missing-unlink-rotation");

  await expect(
    relinkRemoteDocument({
      apiClient: {
        getContainerWriterProjection: async () => {
          projectionReads += 1;
          throw new Error("Unexpected container projection read");
        },
        getDocumentWriterProjection: async () => {
          projectionReads += 1;
          throw new Error("Unexpected document projection read");
        },
        primeDocumentWriterProjection: () => {},
        linkDocument: async () => {
          throw new Error("Unexpected link call");
        },
        unlinkDocument: async () => {
          throw new Error("Unexpected unlink call");
        },
      },
      author,
      documentId: "document-without-rotation-snapshot",
      execSql,
      operation: "unlink",
      resolveProjectionUserKey: async () => null,
      targetContainerId: "target-container",
      targetSecretKey: crypto.getRandomValues(new Uint8Array(32)),
    }),
  ).rejects.toThrow(
    "Document unlink requires a proven full-history rotation snapshot",
  );
  expect(projectionReads).toBe(0);
  close();
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
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-link",
    targetSecretKey: keyPair.secretKey,
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
  const submittedRequests: DocumentLinkSetMutationRequest[] = [];
  const primedProjections: Array<{
    documentId: string;
    projection: DocumentWriterProjectionResponse;
  }> = [];
  const { close, execSql } = await createTestExecSql("remote-document-link");

  const linked = await relinkRemoteDocument({
    apiClient: {
      getContainerWriterProjection: async (containerId) =>
        containerId === siblingProjection.containerId
          ? siblingProjection
          : null,
      getDocumentWriterProjection: async (documentId) =>
        documentId === writerProjection.documentId ? writerProjection : null,
      primeDocumentWriterProjection: (documentId, primed) => {
        primedProjections.push({ documentId, projection: primed });
      },
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
    execSql,
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
  // The link response carries enough to seed a verifiable writer projection,
  // so the first read after link resolves locally instead of a cold GET.
  expect(primedProjections).toHaveLength(1);
  const primedProjection = primedProjections[0]?.projection;
  expect(primedProjections[0]?.documentId).toBe(linked.response.id);
  if (!primedProjection) {
    throw new Error("Expected primed projection");
  }
  expect(primedProjection.authorizingContainerPaths).toEqual([
    projection,
    siblingProjection,
  ]);
  expect(primedProjection.contentKeyBundle).toEqual(
    linked.response.contentKeyBundle,
  );
  expect(primedProjection.documentId).toBe(linked.response.id);
  expect(primedProjection.documentKekTargets).toEqual(
    linked.response.documentKekTargets,
  );
  expect(primedProjection.documentManifest).toEqual(
    linked.response.accessManifest,
  );
  expect(
    primedProjection.documentManifestHistory?.map(
      (bundle) => bundle.manifestHash,
    ),
  ).toEqual([writerProjection.documentManifest.manifestHash]);
  const rootManifestHash = projection.path.at(-1)?.manifestHash;
  const siblingManifestHash = siblingProjection.path.at(-1)?.manifestHash;
  if (!rootManifestHash || !siblingManifestHash) {
    throw new Error("Expected container projection leaf manifests");
  }
  expect(
    primedProjection.documentManifestContainerPaths?.map(
      (path) => path.at(-1)?.manifestHash,
    ),
  ).toEqual([rootManifestHash, siblingManifestHash]);
  expect(
    primedProjection.documentContainerManifestHistory?.map(
      (bundle) => bundle.manifestHash,
    ),
  ).toEqual([rootManifestHash, siblingManifestHash]);
  close();
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
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const created = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    documentId: "document-remote-unlink",
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
  });
  const createdResponse = createResponse(created.plan);
  const initialWriterProjection: DocumentWriterProjectionResponse = {
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
    targetSecretKey: keyPair.secretKey,
    trustedLocalProjection: true,
    writerProjection: initialWriterProjection,
  });
  const linkResponse = await createLinkSetResponseFromRequest(
    initialWriterProjection.documentId,
    linked.plan.request,
  );
  const linkedWriterProjection: DocumentWriterProjectionResponse = {
    authorizingContainerPaths: [projection, siblingProjection],
    contentKeyBundle: linkResponse.contentKeyBundle,
    ...writerProjectionEvidence(
      [projection, siblingProjection],
      [initialWriterProjection.documentManifest],
    ),
    documentId: linkResponse.id,
    documentKekTargets: linkResponse.documentKekTargets,
    documentManifest: linkResponse.accessManifest,
  };
  const tamperedTargetProjection = structuredClone(projection);
  const signedEvent = tamperedTargetProjection.path[0]?.event
    ?.event as unknown as AccessEvent | undefined;
  const signature = signedEvent?.signature;
  if (!signedEvent || typeof signature !== "string" || signature.length === 0) {
    throw new Error("Expected signed target container event fixture");
  }
  signedEvent.signature = `${signature.slice(0, -1)}${
    signature.endsWith("A") ? "B" : "A"
  }`;
  const rotationDocument = await createDocument("remote-unlink-rotation");
  rotationDocument.getText("text").update("rotation state");
  rotationDocument.commit();
  let unlinkCalled = false;
  const { close, execSql } = await createTestExecSql(
    "bad-unlink-target-signature",
  );

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
        primeDocumentWriterProjection: () => {},
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
      execSql,
      operation: "unlink",
      resolveProjectionUserKey,
      rotationSnapshot: exportFullHistorySnapshot(rotationDocument),
      targetContainerId: projection.containerId,
      targetSecretKey: keyPair.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(unlinkCalled).toBe(false);
  close();
});
