import { expect, test } from "bun:test";
import { unwrapDocumentContentKeyTarget } from "@tearleads/client-sdk";
import {
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createContainerWriterProjectionFixture } from "@tearleads/test-utils";
import {
  type DocumentCreateRequest,
  isDocumentCreateRequest,
} from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
  substituteFirstProjectionUserWrapMaterial,
  tamperFirstProjectionEventSignature,
} from "../../../test/helpers/containerFixtures";
import {
  createAuthor,
  createResponseFromRequest,
  createWrappedProjection,
} from "../../../test/helpers/documentFixtures";
import {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
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
  const primedProjections: Array<{
    documentId: string;
    projection: DocumentWriterProjectionResponse;
  }> = [];
  const created = await createRemoteDocument({
    apiClient: {
      createDocument: async (request) => {
        submittedRequests.push(request);
        return createResponseFromRequest(request);
      },
      getContainerWriterProjection: async (containerId) =>
        containerId === projection.containerId ? projection : null,
      primeDocumentWriterProjection: (documentId, primed) => {
        primedProjections.push({ documentId, projection: primed });
      },
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
  const { response } = created;
  if (!response) {
    throw new Error("Expected create response on a fresh create result");
  }
  expect(submittedRequests).toHaveLength(1);
  expect(created.persistedState).toEqual({
    documentId: "document-remote",
    contentKeyBundle: JSON.stringify(response.contentKeyBundle),
    documentKekTargets: JSON.stringify(response.documentKekTargets),
    documentManifestBundle: JSON.stringify(response.accessManifest),
  });
  expect(created.writerProjection).toEqual({
    authorizingContainerPaths: [projection],
    contentKeyBundle: response.contentKeyBundle,
    documentId: "document-remote",
    documentKekTargets: response.documentKekTargets,
    documentManifest: response.accessManifest,
  });
  // The create response carries enough to seed the projection cache, so the
  // first read after create resolves locally instead of a cold GET.
  expect(primedProjections).toEqual([
    { documentId: "document-remote", projection: created.writerProjection },
  ]);
});

test("createRemoteDocument adopts an existing remote document when a retry with a stable id conflicts", async () => {
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
  const resolveProjectionUserKey = async (userId: string) =>
    userId === author.signerUserId
      ? {
          encapsulationPublicKey: keyPair.publicKey,
          signingPublicKey,
          userId,
        }
      : null;

  // Simulates a server that already committed the create (from a first attempt
  // whose response was lost): the first submit returns a network failure but
  // records the committed document; the retry then 409s on the stable id. A
  // holder object keeps the committed projection typed after the closure runs.
  const server: {
    commitCount: number;
    committed: { projection: DocumentWriterProjectionResponse } | null;
  } = { commitCount: 0, committed: null };
  const primedProjections: Array<{
    documentId: string;
    projection: DocumentWriterProjectionResponse;
  }> = [];
  const apiClient = {
    createDocument: async () => null,
    createDocumentResult: async (request: DocumentCreateRequest) => {
      if (server.committed) {
        return {
          message:
            "POST /documents: 409 Conflict: Document manifest already exists",
          ok: false as const,
          report: () => {},
          status: 409,
        };
      }
      const response = await createResponseFromRequest(request);
      server.committed = {
        projection: documentWriterProjectionFromCreateResponse({
          containerProjection: projection,
          response,
        }),
      };
      server.commitCount += 1;
      // The commit succeeded server-side, but the response never reached us.
      return {
        message: "POST /documents: network error",
        ok: false as const,
        report: () => {},
        status: null,
      };
    },
    getContainerWriterProjection: async (containerId: string) =>
      containerId === projection.containerId ? projection : null,
    getDocumentWriterProjection: async (documentId: string) =>
      server.committed?.projection.documentId === documentId
        ? server.committed.projection
        : null,
    primeDocumentWriterProjection: (
      documentId: string,
      primed: DocumentWriterProjectionResponse,
    ) => {
      primedProjections.push({ documentId, projection: primed });
    },
  };

  const knownContentKey = crypto.getRandomValues(new Uint8Array(32));
  // First attempt: commits server-side, but the response is lost, so the caller
  // sees a failure and no result.
  const firstAttempt = await createRemoteDocument({
    apiClient,
    author,
    containerId: projection.containerId,
    contentKey: knownContentKey,
    documentId: "document-stable",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });
  expect(firstAttempt).toBeNull();
  const committedProjection = server.committed?.projection;
  if (!committedProjection) {
    throw new Error("Expected the first attempt to commit a document");
  }

  // Retry with the same stable id: the server 409s, and the client adopts the
  // already-committed document instead of creating a duplicate.
  const adopted = await createRemoteDocument({
    apiClient,
    author,
    containerId: projection.containerId,
    documentId: "document-stable",
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: keyPair.secretKey,
  });
  if (!adopted) {
    throw new Error("Expected the retry to adopt the existing remote document");
  }

  // Exactly one document was created server-side.
  expect(server.commitCount).toBe(1);
  expect(adopted.documentId).toBe("document-stable");
  // Adopt has no fresh create response or matching plan.
  expect(adopted.response).toBeUndefined();
  expect(adopted.plan).toBeUndefined();
  // The recovered content key is the committed one, not the retry's fresh key.
  expect(Array.from(adopted.contentKey)).toEqual(Array.from(knownContentKey));
  expect(adopted.writerProjection).toEqual(committedProjection);
  expect(primedProjections).toContainEqual({
    documentId: "document-stable",
    projection: committedProjection,
  });
});

test("createRemoteDocument does not report a conflict when adoption fails transiently", async () => {
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
  let reported = false;
  const adopted = await createRemoteDocument({
    apiClient: {
      createDocument: async () => null,
      // Every submit 409s (the first attempt already committed remotely).
      createDocumentResult: async () => ({
        message:
          "POST /documents: 409 Conflict: Document manifest already exists",
        ok: false as const,
        report: () => {
          reported = true;
        },
        status: 409,
      }),
      getContainerWriterProjection: async (containerId: string) =>
        containerId === projection.containerId ? projection : null,
      // Adoption cannot complete: the writer-projection fetch fails transiently.
      getDocumentWriterProjection: async () => null,
      primeDocumentWriterProjection: () => {},
    },
    author,
    containerId: projection.containerId,
    documentId: "document-stable",
    resolveProjectionUserKey: async (userId: string) =>
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

  // The conflict is expected during an idempotent retry; failing to adopt it yet
  // must not surface as a UI error — the sync engine retries on a later tick.
  expect(adopted).toBeNull();
  expect(reported).toBe(false);
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
        primeDocumentWriterProjection: () => {},
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
        primeDocumentWriterProjection: () => {},
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
