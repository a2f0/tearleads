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
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../documents/linkSet";
import { moveRemoteContainerDocument } from "./documentLinks";

async function createRotationSnapshot() {
  const document = await createDocument("replace-links-rotation");
  document.getText("text").update("rotation state");
  document.commit();
  return exportFullHistorySnapshot(document);
}

test("moveRemoteContainerDocument can replace every existing link with the target", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-replace-links-test",
  );

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const contactsProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-move-contacts-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const extraProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-move-extra-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: contactsProjection,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const trashProjection = await createContainerWriterProjectionFixture({
      containerId: "containerContents-move-trash-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: contactsProjection,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const projectionsById = new Map(
      [contactsProjection, extraProjection, trashProjection].map(
        (projection) => [projection.containerId, projection],
      ),
    );
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
      containerProjection: contactsProjection,
      documentId: "containerContents-replaced-document",
      execSql,
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    const initialWriterProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [contactsProjection],
      contentKeyBundle: createdResponse.contentKeyBundle,
      documentContainerManifestHistory: [
        ...contactsProjection.path,
        ...contactsProjection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
      ],
      documentId: createdResponse.id,
      documentKekTargets: createdResponse.documentKekTargets,
      documentManifest: createdResponse.accessManifest,
      documentManifestContainerPaths: [[...contactsProjection.path]],
      documentManifestHistory: [],
    };
    const extraLink = await buildMaterializedDocumentLinkSetMutationPlan({
      author,
      execSql,
      operation: "link",
      resolveProjectionUserKey,
      targetContainerProjection: extraProjection,
      targetSecretKey: keyPair.secretKey,
      writerProjection: initialWriterProjection,
    });
    const extraLinkResponse = await createLinkSetResponseFromRequest(
      initialWriterProjection.documentId,
      extraLink.plan.request,
    );
    let writerProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [contactsProjection, extraProjection],
      contentKeyBundle: extraLinkResponse.contentKeyBundle,
      documentContainerManifestHistory: [
        ...contactsProjection.path,
        ...contactsProjection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
        ...extraProjection.path,
        ...extraProjection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
      ],
      documentId: extraLinkResponse.id,
      documentKekTargets: extraLinkResponse.documentKekTargets,
      documentManifest: extraLinkResponse.accessManifest,
      documentManifestContainerPaths: [
        [...contactsProjection.path],
        [...extraProjection.path],
      ],
      documentManifestHistory: [createdResponse.accessManifest],
    };
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      writerProjection.documentId,
      [contactsProjection.containerId, extraProjection.containerId],
    );
    const submittedRequests: Array<{
      operation: "link" | "unlink";
      targetContainerId: string;
    }> = [];

    const moved = await moveRemoteContainerDocument({
      currentContainerId: contactsProjection.containerId,
      documentId: writerProjection.documentId,
      noteId: "containerContents-note-1",
      replaceLinkedContainers: true,
      resolveProjectionUserKey,
      rotationSnapshot: await createRotationSnapshot(),
      runtime: {
        apiClient: {
          getContainerWriterProjection: async (containerId) =>
            projectionsById.get(containerId) ?? null,
          getDocumentWriterProjection: async (documentId) =>
            documentId === writerProjection.documentId
              ? writerProjection
              : null,
          getCurrentPrincipalPolicy: async () => null,
          primeDocumentWriterProjection: (documentId, primedProjection) => {
            if (documentId === writerProjection.documentId) {
              writerProjection = primedProjection;
            }
          },
          linkDocument: async (documentId, request) => {
            const targetContainerId = String(
              Reflect.get(
                request.body as Record<string, unknown>,
                "containerId",
              ),
            );
            submittedRequests.push({
              operation: "link",
              targetContainerId,
            });
            return createLinkSetResponseFromRequest(documentId, request);
          },
          unlinkDocument: async (documentId, request) => {
            const targetContainerId = String(
              Reflect.get(
                request.body as Record<string, unknown>,
                "containerId",
              ),
            );
            submittedRequests.push({
              operation: "unlink",
              targetContainerId,
            });
            return createLinkSetResponseFromRequest(documentId, request);
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
      targetContainerId: trashProjection.containerId,
    });

    expect(submittedRequests[0]).toEqual({
      operation: "link",
      targetContainerId: trashProjection.containerId,
    });
    expect(submittedRequests.slice(1)).toEqual(
      expect.arrayContaining([
        {
          operation: "unlink",
          targetContainerId: contactsProjection.containerId,
        },
        {
          operation: "unlink",
          targetContainerId: extraProjection.containerId,
        },
      ]),
    );
    expect(moved?.status).toBe("complete");
    expect(moved?.nextContainerId).toBe(trashProjection.containerId);
    expect(moved?.linkedContainerIds).toEqual([trashProjection.containerId]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        writerProjection.documentId,
      ),
    ).resolves.toEqual([trashProjection.containerId]);
  } finally {
    close();
  }
}, 10000);
