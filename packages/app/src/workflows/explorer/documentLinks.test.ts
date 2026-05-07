import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createContainerWriterProjectionFixture } from "../../../test/helpers/createContainerWriterProjectionFixture";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
} from "../../data/documents/documentTestFixtures";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import {
  moveRemoteExplorerDocument,
  relinkRemoteExplorerDocument,
} from "./documentLinks";

test("relinkRemoteExplorerDocument persists linked container projections after a successful remote mutation", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-links-test",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "explorer-link-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const siblingProjection = await createContainerWriterProjectionFixture({
      containerId: "explorer-link-sibling-container",
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
      documentId: "explorer-linked-document",
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

    const linked = await relinkRemoteExplorerDocument({
      documentId: writerProjection.documentId,
      noteId: "explorer-note-1",
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
          linkDocument: async (documentId, request) => {
            submittedRequests.push(request);
            return createLinkSetResponseFromRequest(documentId, request);
          },
          unlinkDocument: async () => {
            throw new Error("Unexpected unlink call");
          },
        },
        encapsulationKeyPair: { secretKey: keyPair.secretKey },
        execSql,
        log: () => undefined,
        organizationId: author.organizationId,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: { signingPrivateKey: author.signerPrivateKey },
        userId: author.signerUserId,
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

test("moveRemoteExplorerDocument links the target before unlinking the current container", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-move-test",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "explorer-move-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const siblingProjection = await createContainerWriterProjectionFixture({
      containerId: "explorer-move-sibling-container",
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
      documentId: "explorer-moved-document",
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
      operation: "link" | "unlink";
      targetContainerId: string;
    }> = [];

    const moved = await moveRemoteExplorerDocument({
      currentContainerId: rootProjection.containerId,
      documentId: writerProjection.documentId,
      noteId: "explorer-note-1",
      resolveProjectionUserKey,
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
          linkDocument: async (documentId, request) => {
            submittedRequests.push({
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
        encapsulationKeyPair: { secretKey: keyPair.secretKey },
        execSql,
        log: () => undefined,
        organizationId: author.organizationId,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: { signingPrivateKey: author.signerPrivateKey },
        userId: author.signerUserId,
      },
      targetContainerId: siblingProjection.containerId,
    });

    expect(submittedRequests).toEqual([
      {
        operation: "link",
        targetContainerId: siblingProjection.containerId,
      },
      {
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
