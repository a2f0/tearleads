import { expect, test } from "bun:test";
import {
  type RemoteDocumentCreateRuntime,
  unwrapDocumentContentKeyTarget,
} from "@tearleads/client-sdk/workflows/documents";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import {
  type DocumentCreateRequest,
  isDocumentCreateRequest,
} from "@tearleads/validators/request";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
  tamperFirstProjectionEventSignature,
} from "../../../test/helpers/containerFixtures";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import {
  createAuthor,
  createResponseFromRequest,
  createWrappedProjection,
} from "../../../test/helpers/documentFixtures";
import {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  createRemoteDocumentFromRuntime,
} from "./create";

test("buildMaterializedDocumentCreatePlan wraps the content key to the target container KEK", async () => {
  const { author } = await createAuthor();
  const { childContainerKek, projection, secretKey } =
    await createWrappedProjection();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const materialized = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: projection,
    contentKey,
    documentId: "document-materialized",
    eventId: "event-materialized",
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
  });
  const [targetEnvelope] = materialized.plan.request.contentKeyBundle.targets;
  if (!targetEnvelope) {
    throw new Error("Expected a materialized content-key target");
  }
  const unwrappedContentKey = await unwrapDocumentContentKeyTarget({
    containerKek: childContainerKek,
    envelope: targetEnvelope,
  });

  expect(Array.from(materialized.contentKey)).toEqual(Array.from(contentKey));
  expect(Array.from(unwrappedContentKey)).toEqual(Array.from(contentKey));
  expect(targetEnvelope.wrappingMetadata).toEqual(
    expect.objectContaining({
      suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
    }),
  );
  const childManifest = projection.path[1];
  const childKek = projection.containerKeks[1];
  if (!childManifest || !childKek) {
    throw new Error("Expected child projection fixture");
  }
  expect(materialized.plan.targets).toEqual([
    {
      containerId: projection.containerId,
      containerManifestHash: childManifest.manifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: 1,
    },
  ]);
  expect(isDocumentCreateRequest(materialized.plan.request)).toBe(true);
});

test("createRemoteDocument submits the materialized request and persists the verified response", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "remote-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const submittedRequests: DocumentCreateRequest[] = [];
  const created = await createRemoteDocument({
    apiClient: {
      createDocument: async (request) => {
        submittedRequests.push(request);
        return createResponseFromRequest(request);
      },
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
    },
    author,
    containerId: projection.containerId,
    documentId: "document-remote",
    eventId: "event-remote",
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: keyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });

  expect(created?.documentId).toBe("document-remote");
  if (!created) {
    throw new Error("Expected remote document create result");
  }
  expect(submittedRequests).toHaveLength(1);
  expect(created.persistedState).toEqual({
    documentId: "document-remote",
    contentKeyBundle: JSON.stringify(created.response.contentKeyBundle),
    documentKekTargets: JSON.stringify(created.response.documentKekTargets),
    documentManifestBundle: JSON.stringify(created.response.accessManifest),
  });
});

test("createRemoteDocument rejects substituted KEK material before submitting", async () => {
  const parent = await createParentProjection();
  const tamperedProjection = await substituteFirstProjectionUserWrapMaterial({
    projection: parent.projection,
    publicKey: parent.encapsulationPublicKey,
    userId: parent.userId,
  });
  let createCalled = false;

  await expect(
    createRemoteDocument({
      apiClient: {
        createDocument: async () => {
          createCalled = true;
          throw new Error("Unexpected document create");
        },
        getContainerWriterProjection: async (containerId) =>
          containerId === tamperedProjection.containerId
            ? tamperedProjection
            : null,
      },
      author: parent.author,
      containerId: tamperedProjection.containerId,
      documentId: "document-substituted-kek",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("KEK material does not match committed epoch id");
  expect(createCalled).toBe(false);
});

test("createRemoteDocument rejects bad container projection signatures before submitting", async () => {
  const parent = await createParentProjection();
  const tamperedProjection = tamperFirstProjectionEventSignature(
    parent.projection,
  );
  let createCalled = false;

  await expect(
    createRemoteDocument({
      apiClient: {
        createDocument: async () => {
          createCalled = true;
          throw new Error("Unexpected document create");
        },
        getContainerWriterProjection: async (containerId) =>
          containerId === tamperedProjection.containerId
            ? tamperedProjection
            : null,
      },
      author: parent.author,
      containerId: tamperedProjection.containerId,
      documentId: "document-bad-container-signature",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow(
    "Container writer projection path[0] signature verification failed",
  );
  expect(createCalled).toBe(false);
});

test("createRemoteDocumentFromRuntime resolves author and container from runtime", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "runtime-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const submittedRequests: DocumentCreateRequest[] = [];
  const runtime: RemoteDocumentCreateRuntime = {
    apiClient: {
      createDocument: async (request) => {
        submittedRequests.push(request);
        return createResponseFromRequest(request);
      },
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
    },
    containerId: projection.containerId,
    log: () => undefined,
    organizationId: author.organizationId,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
    },
    userId: author.signerUserId,
  };
  const created = await createRemoteDocumentFromRuntime({
    documentId: "document-runtime",
    eventId: "event-runtime",
    missingContainerLogMessage:
      "Documents: cannot create a remote document without a container.",
    resolveProjectionUserKey: async (userId) =>
      userId === author.signerUserId
        ? {
            encapsulationPublicKey: keyPair.publicKey,
            signingPublicKey,
            userId,
          }
        : null,
    runtime,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
    unavailableWriterLogMessage:
      "Documents: skipped remote create because the writer context is unavailable.",
  });

  expect(submittedRequests).toHaveLength(1);
  expect(created?.documentId).toBe("document-runtime");
});

test("createRemoteDocumentFromRuntime logs missing prerequisites before creating", async () => {
  const logs: string[] = [];
  const apiClient = {
    createDocument: async () => {
      throw new Error("Expected missing prerequisites to skip remote create");
    },
    getContainerWriterProjection: async () => {
      throw new Error("Expected missing prerequisites to skip remote create");
    },
  };
  const missingContainer = await createRemoteDocumentFromRuntime({
    missingContainerLogMessage: "Documents: missing container.",
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient,
      containerId: null,
      log: (message) => logs.push(message),
    },
    targetSecretKey: new Uint8Array(),
    unavailableWriterLogMessage: "Documents: missing writer.",
  });
  const missingWriter = await createRemoteDocumentFromRuntime({
    missingContainerLogMessage: "Documents: missing container.",
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient,
      containerId: "container-1",
      log: (message) => logs.push(message),
    },
    targetSecretKey: new Uint8Array(),
    unavailableWriterLogMessage: "Documents: missing writer.",
  });

  expect(missingContainer).toBeNull();
  expect(missingWriter).toBeNull();
  expect(logs).toEqual([
    "Documents: missing container.",
    "Documents: missing writer.",
  ]);
});
