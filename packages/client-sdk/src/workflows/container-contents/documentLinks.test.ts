import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
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
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentsPersistence } from "../documents";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import {
  purgeLocalContainerDocument,
  relinkRemoteContainerDocument,
} from "./documentLinks";

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
      documentId: "containerContents-linked-document",
      execSql,
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    const writerProjection: DocumentWriterProjectionResponse = {
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
          getCurrentPrincipalPolicy: async () => null,
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

test("relinkRemoteContainerDocument propagates identity failures without soft-failing", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-link-identity-failure",
  );
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const logs: string[] = [];
  let projectionRequests = 0;

  try {
    await expect(
      relinkRemoteContainerDocument({
        documentId: "document",
        noteId: "note",
        operation: "link",
        resolveProjectionUserKey: async () => null,
        runtime: {
          apiClient: {
            getContainerWriterProjection: async () => null,
            getDocumentWriterProjection: async () => {
              projectionRequests += 1;
              throw integrityError;
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
          resolveTrustedUserIdentity: async () => null,
          state: {
            containerId: null,
            domainScope: null as never,
            events: [],
            online: true,
          },
          util: {
            log: (message: string) => logs.push(message),
          },
        } as unknown as Parameters<
          typeof relinkRemoteContainerDocument
        >[0]["runtime"],
        targetContainerId: "target",
      }),
    ).rejects.toBe(integrityError);
    expect(projectionRequests).toBe(1);
    expect(logs).toEqual([]);
  } finally {
    close();
  }
});
