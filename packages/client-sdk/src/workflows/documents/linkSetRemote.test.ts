import { expect, test } from "bun:test";
import { type AccessEvent, generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import { persistedDocumentLinkSetMutationStateFromResponse } from "../../data/documents/shared/responses";
import { buildMaterializedDocumentCreatePlan } from "./create";
import {
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "./linkSet";

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
    ?.event as unknown as AccessEvent | undefined;
  const signature = signedEvent?.signature;
  if (!signedEvent || typeof signature !== "string" || signature.length === 0) {
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
