import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import {
  createDocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import { verifyDocumentWriterProjection } from "../../data/keyingProjectionVerification";
import type { DocumentsPersistence } from "../documents";
import { purgeRemoteContainerDocument } from "./documentPurge";

test("purge retry refuses a document recreated before the absence transaction", async () => {
  const {
    author,
    publicKey,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const proof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "document-purge-recreation-race",
  );
  let absenceChecks = 0;
  const logs: string[] = [];
  const persistence = {
    deleteDocumentSideRowsIfAbsent: async () => {
      absenceChecks += 1;
      return false;
    },
    ensureSchema: async () => undefined,
    loadDocument: async () => null,
  } as unknown as DocumentsPersistence;

  try {
    await expect(
      purgeRemoteContainerDocument({
        documentId: writerProjection.documentId,
        documentKind: "note",
        noteId: "local-document",
        persistence,
        resolveProjectionUserKey,
        runtime: {
          apiClient: {
            getCurrentPrincipalPolicy: async () => null,
            getDocumentPurgeProof: async () => {
              throw new Error("Unexpected purge-proof fetch");
            },
            getDocumentWriterProjectionResult: async () => ({
              data: writerProjection,
              ok: true,
            }),
            purgeDocument: async () => ({
              ...proof,
              reclaimedBlobStorageKeys: [],
            }),
          },
          auth: {
            isAuthenticated: true,
            organizationId: author.organizationId,
            userId: author.signerUserId,
          },
          crypto: {
            encapsulationKeyPair: {
              publicKey,
              secretKey,
            },
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
            log: (message) => logs.push(message),
            reportSecurityIncident: async () => undefined,
          },
        },
      }),
    ).resolves.toBeNull();

    expect(absenceChecks).toBe(1);
    expect(logs.at(-1)).toContain(
      "Local document state changed while its remote purge was committing",
    );
    // The losing absence check must leave the terminal checkpoint uncommitted.
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: writerProjection,
        resolveUserKey: resolveProjectionUserKey,
      }),
    ).resolves.toBeDefined();
  } finally {
    close();
  }
});

test("purge retry deletes an absent custom document projection with its proof", async () => {
  const fixture = await createMaterializedSyncFixture();
  const proof = await createDocumentPurgeProof(
    fixture.author,
    fixture.writerProjection,
  );
  const { close, execSql } = await createTestExecSql(
    "document-purge-absent-projection",
  );
  const projectionDeletes: string[] = [];
  const documentProjectors = createDocumentProjectorRegistry([
    {
      clientProjection: {
        delete: ({ localId }) => {
          projectionDeletes.push(localId);
        },
        save: () => undefined,
        tables: [],
      },
      kind: "contact",
    },
  ]);
  const persistence = {
    deleteDocumentSideRowsIfAbsent: async (
      _execSql: typeof execSql,
      _localId: string,
      _documentId: string | null,
      deleteClientProjection: (
        transactionExecSql: typeof execSql,
      ) => Promise<void>,
    ) => {
      await deleteClientProjection(execSql);
      return true;
    },
    ensureSchema: async () => undefined,
    loadDocument: async () => null,
  } as unknown as DocumentsPersistence;

  try {
    await expect(
      purgeRemoteContainerDocument({
        documentId: fixture.writerProjection.documentId,
        documentKind: "contact",
        noteId: "local-document",
        persistence,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        runtime: {
          apiClient: {
            getCurrentPrincipalPolicy: async () => null,
            getDocumentPurgeProof: async () => {
              throw new Error("Unexpected purge-proof fetch");
            },
            getDocumentWriterProjectionResult: async () => ({
              data: fixture.writerProjection,
              ok: true,
            }),
            purgeDocument: async () => ({
              ...proof,
              reclaimedBlobStorageKeys: [],
            }),
          },
          auth: {
            isAuthenticated: true,
            organizationId: fixture.author.organizationId,
            userId: fixture.author.signerUserId,
          },
          crypto: {
            encapsulationKeyPair: {
              publicKey: fixture.publicKey,
              secretKey: fixture.secretKey,
            },
            signingFingerprint: fixture.author.signerKeyFingerprint,
            signingKeyPair: {
              signingPrivateKey: fixture.author.signerPrivateKey,
              signingPublicKey: fixture.signingPublicKey,
            },
          },
          infra: {
            blobStore: null as never,
            dbStatus: "ready",
            documentProjectors,
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
            log: () => undefined,
            reportSecurityIncident: async () => undefined,
          },
        },
      }),
    ).resolves.toMatchObject({
      documentId: fixture.writerProjection.documentId,
    });

    expect(projectionDeletes).toEqual(["local-document"]);
    await expect(
      verifyDocumentWriterProjection({
        execSql,
        projection: fixture.writerProjection,
        resolveUserKey: fixture.resolveProjectionUserKey,
      }),
    ).rejects.toThrow("purged");
  } finally {
    close();
  }
});
