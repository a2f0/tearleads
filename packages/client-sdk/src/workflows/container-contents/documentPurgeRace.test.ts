import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
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
