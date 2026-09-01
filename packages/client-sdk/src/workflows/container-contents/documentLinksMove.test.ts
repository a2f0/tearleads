import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
  writerProjectionEvidence,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { moveRemoteContainerDocument } from "./documentLinks";

async function createRotationSnapshot(seed: string) {
  const document = await createDocument(seed);
  document.getText("text").update("rotation state");
  document.commit();
  return exportFullHistorySnapshot(document);
}

async function runMoveRemoteContainerDocumentFixture(input: {
  rotationSnapshot: Uint8Array;
  testDbName: string;
}) {
  const { close, execSql } = await createTestExecSql(input.testDbName);

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
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: keyPair.publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey,
            userId,
          })
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
      ...writerProjectionEvidence([rootProjection], []),
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
      rotationSnapshot: input.rotationSnapshot,
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
          getCurrentPrincipalPolicy: async () => null,
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
              ...writerProjectionEvidence(
                [rootProjection, siblingProjection],
                [
                  writerProjection.documentManifest,
                  ...writerProjection.documentManifestHistory,
                ],
              ),
              documentId: response.id,
              documentKekTargets: response.documentKekTargets,
              documentManifest: response.accessManifest,
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
              ...writerProjectionEvidence(
                [rootProjection, siblingProjection],
                [
                  writerProjection.documentManifest,
                  ...writerProjection.documentManifestHistory,
                ],
              ),
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
        resolveTrustedUserIdentity: resolveProjectionUserKey,
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
          log: () => undefined,
          reportSecurityIncident: async () => undefined,
        },
      },
      targetContainerId: siblingProjection.containerId,
    });

    const linkedContainerIds =
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        writerProjection.documentId,
      );
    return {
      moved,
      linkedContainerIds,
      rootContainerId: rootProjection.containerId,
      siblingContainerId: siblingProjection.containerId,
      submittedRequests,
    };
  } finally {
    close();
  }
}

test("moveRemoteContainerDocument links the target before unlinking the current container", async () => {
  const fixture = await runMoveRemoteContainerDocumentFixture({
    rotationSnapshot: await createRotationSnapshot("move-rotation"),
    testDbName: "containerContents-document-move-test",
  });

  expect(fixture.submittedRequests).toEqual([
    {
      hasRotationBaseline: false,
      operation: "link",
      targetContainerId: fixture.siblingContainerId,
    },
    {
      hasRotationBaseline: true,
      operation: "unlink",
      targetContainerId: fixture.rootContainerId,
    },
  ]);
  expect(fixture.moved?.status).toBe("complete");
  expect(fixture.moved?.nextContainerId).toBe(fixture.siblingContainerId);
  expect(fixture.moved?.linkedContainerIds).toEqual([
    fixture.siblingContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual([fixture.siblingContainerId]);
});

test("moveRemoteContainerDocument completes an empty document move with a baseline-less unlink", async () => {
  const emptyDocument = await createDocument("empty-move-rotation");
  const fixture = await runMoveRemoteContainerDocumentFixture({
    rotationSnapshot: exportFullHistorySnapshot(emptyDocument),
    testDbName: "containerContents-empty-document-move-test",
  });

  expect(fixture.submittedRequests).toEqual([
    {
      hasRotationBaseline: false,
      operation: "link",
      targetContainerId: fixture.siblingContainerId,
    },
    {
      hasRotationBaseline: false,
      operation: "unlink",
      targetContainerId: fixture.rootContainerId,
    },
  ]);
  expect(fixture.moved?.status).toBe("complete");
  expect(fixture.moved?.linkedContainerIds).toEqual([
    fixture.siblingContainerId,
  ]);
  expect(fixture.linkedContainerIds).toEqual([fixture.siblingContainerId]);
});
