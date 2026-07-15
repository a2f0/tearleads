import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
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
} from "../../../test/helpers/documentFixtures";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentsPersistence } from "../documents";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import {
  moveRemoteContainerDocument,
  purgeLocalContainerDocument,
  relinkRemoteContainerDocument,
} from "./documentLinks";

async function createRotationSnapshot(seed: string) {
  const document = await createDocument(seed);
  document.getText("text").update("rotation state");
  document.commit();
  return exportFullHistorySnapshot(document);
}

test("relinkRemoteContainerDocument persists linked container projections after a successful remote mutation", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-links-test",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-link-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const siblingProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-link-sibling-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: rootProjection,
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
      containerProjection: rootProjection,
      documentId: "containerContents-linked-document",
      execSql,
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    const writerProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [rootProjection],
      contentKeyBundle: createdResponse.contentKeyBundle,
      documentId: createdResponse.id,
      documentKekTargets: createdResponse.documentKekTargets,
      documentManifest: createdResponse.accessManifest,
    };
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      writerProjection.documentId,
      [rootProjection.containerId],
    );
    const submittedRequests: DocumentLinkSetMutationRequest[] = [];

    const linked = await relinkRemoteContainerDocument({
      documentId: writerProjection.documentId,
      noteId: "containerContents-note-1",
      operation: "link",
      resolveProjectionUserKey,
      runtime: {
        apiClient: {
          getContainerWriterProjection: async (containerId) =>
            containerId === siblingProjection.containerId
              ? siblingProjection
              : null,
          getDocumentWriterProjection: async (documentId) =>
            documentId === writerProjection.documentId
              ? writerProjection
              : null,
          primeDocumentWriterProjection: () => {},
          linkDocument: async (documentId, request) => {
            submittedRequests.push(request);
            return createLinkSetResponseFromRequest(documentId, request);
          },
          unlinkDocument: async () => {
            throw new Error("Unexpected unlink call");
          },
        },
        auth: {
          isAuthenticated: true,
          organizationId: author.organizationId,
          userId: author.signerUserId,
        },
        crypto: {
          encapsulationKeyPair: keyPair,
          signingFingerprint: author.signerKeyFingerprint,
          signingKeyPair: {
            signingPrivateKey: author.signerPrivateKey,
            signingPublicKey,
          },
        },
        infra: {
          blobStore: null as never,
          dbStatus: "ready",
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql,
        },
        state: {
          containerId: null,
          domainScope: null as never,
          events: [],
          online: true,
        },
        util: {
          cacheReferencedPrincipalPolicies: async () => undefined,
          log: () => undefined,
        },
      },
      targetContainerId: siblingProjection.containerId,
    });

    const expectedLinkedContainerIds = [
      rootProjection.containerId,
      siblingProjection.containerId,
    ].sort();
    expect(submittedRequests).toHaveLength(1);
    expect(linked?.linkedContainerIds).toEqual(expectedLinkedContainerIds);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        writerProjection.documentId,
      ),
    ).resolves.toEqual(expectedLinkedContainerIds);
  } finally {
    close();
  }
});

test("moveRemoteContainerDocument links the target before unlinking the current container", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-test",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-move-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const siblingProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-move-sibling-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: rootProjection,
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
      containerProjection: rootProjection,
      documentId: "containerContents-moved-document",
      execSql,
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    let writerProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [rootProjection],
      contentKeyBundle: createdResponse.contentKeyBundle,
      documentId: createdResponse.id,
      documentKekTargets: createdResponse.documentKekTargets,
      documentManifest: createdResponse.accessManifest,
    };
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      writerProjection.documentId,
      [rootProjection.containerId],
    );
    const submittedRequests: Array<{
      hasRotationBaseline: boolean;
      operation: "link" | "unlink";
      targetContainerId: string;
    }> = [];

    const moved = await moveRemoteContainerDocument({
      currentContainerId: rootProjection.containerId,
      documentId: writerProjection.documentId,
      noteId: "containerContents-note-1",
      resolveProjectionUserKey,
      rotationSnapshot: await createRotationSnapshot("move-rotation"),
      runtime: {
        apiClient: {
          getContainerWriterProjection: async (containerId) => {
            if (containerId === rootProjection.containerId) {
              return rootProjection;
            }
            if (containerId === siblingProjection.containerId) {
              return siblingProjection;
            }
            return null;
          },
          getDocumentWriterProjection: async (documentId) =>
            documentId === writerProjection.documentId
              ? writerProjection
              : null,
          primeDocumentWriterProjection: () => {},
          linkDocument: async (documentId, request) => {
            submittedRequests.push({
              hasRotationBaseline: request.rotationBaseline !== undefined,
              operation: "link",
              targetContainerId: String(
                Reflect.get(
                  request.body as Record<string, unknown>,
                  "containerId",
                ),
              ),
            });
            const response = await createLinkSetResponseFromRequest(
              documentId,
              request,
            );
            writerProjection = {
              authorizingContainerPaths: [rootProjection, siblingProjection],
              contentKeyBundle: response.contentKeyBundle,
              documentId: response.id,
              documentKekTargets: response.documentKekTargets,
              documentManifest: response.accessManifest,
              documentManifestHistory: [createdResponse.accessManifest],
            };
            return response;
          },
          unlinkDocument: async (documentId, request) => {
            submittedRequests.push({
              hasRotationBaseline: request.rotationBaseline !== undefined,
              operation: "unlink",
              targetContainerId: String(
                Reflect.get(
                  request.body as Record<string, unknown>,
                  "containerId",
                ),
              ),
            });
            const response = await createLinkSetResponseFromRequest(
              documentId,
              request,
            );
            writerProjection = {
              authorizingContainerPaths: [siblingProjection],
              contentKeyBundle: response.contentKeyBundle,
              documentId: response.id,
              documentKekTargets: response.documentKekTargets,
              documentManifest: response.accessManifest,
            };
            return response;
          },
        },
        auth: {
          isAuthenticated: true,
          organizationId: author.organizationId,
          userId: author.signerUserId,
        },
        crypto: {
          encapsulationKeyPair: keyPair,
          signingFingerprint: author.signerKeyFingerprint,
          signingKeyPair: {
            signingPrivateKey: author.signerPrivateKey,
            signingPublicKey,
          },
        },
        infra: {
          blobStore: null as never,
          dbStatus: "ready",
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql,
        },
        state: {
          containerId: null,
          domainScope: null as never,
          events: [],
          online: true,
        },
        util: {
          cacheReferencedPrincipalPolicies: async () => undefined,
          log: () => undefined,
        },
      },
      targetContainerId: siblingProjection.containerId,
    });

    expect(submittedRequests).toEqual([
      {
        hasRotationBaseline: false,
        operation: "link",
        targetContainerId: siblingProjection.containerId,
      },
      {
        hasRotationBaseline: true,
        operation: "unlink",
        targetContainerId: rootProjection.containerId,
      },
    ]);
    expect(moved?.status).toBe("complete");
    expect(moved?.nextContainerId).toBe(siblingProjection.containerId);
    expect(moved?.linkedContainerIds).toEqual([siblingProjection.containerId]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        writerProjection.documentId,
      ),
    ).resolves.toEqual([siblingProjection.containerId]);
  } finally {
    close();
  }
});

test("purgeLocalContainerDocument tears down local state and returns a result", async () => {
  const execSql: ExecSql = (async () => []) as ExecSql;
  const deletedLocalIds: string[] = [];
  const persistence = {
    ensureSchema: async () => undefined,
    loadDocument: async () => null,
    deleteDocument: async (_execSql: ExecSql, localId: string) => {
      deletedLocalIds.push(localId);
    },
  } as unknown as DocumentsPersistence;

  const purged = await purgeLocalContainerDocument({
    noteId: "purge-local-note",
    persistence,
    runtime: {
      infra: {
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      util: { log: () => undefined },
    } as unknown as Parameters<
      typeof purgeLocalContainerDocument
    >[0]["runtime"],
  });

  // A never-synced document has no server row, so purge deletes only local
  // state and still returns a result so the caller refreshes the listing.
  expect(deletedLocalIds).toEqual(["purge-local-note"]);
  expect(purged?.documentId).toBe("purge-local-note");
  expect(purged?.reclaimedBlobStorageKeys).toEqual([]);
});
