import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  getTextValue,
  importSnapshot,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentCreateRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  type DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createResponseFromRequest,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import {
  importDecryptedDocumentSyncUpdates,
  isDocumentSyncUpdateIsolationError,
  validateDocumentSyncUpdateImports,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  clientSqlTables,
  containers,
  documentHistoryCheckpoints,
  documentPendingUpdates,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import type { ExecSql } from "../../sqlite";
import {
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
} from "../documents/create";
import { clearRemoteSyncState } from "./remoteReset";

const LOCAL_ID = "shared-note";
const OLD_CONTAINER_ID = "retained-old-root";
const STALE = "2026-08-01T00:00:00.000Z";

type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

interface RecoveryClient {
  close: () => void;
  execSql: ExecSql;
  pending: {
    id: string;
    partialEndVersionVector: string;
    partialStartVersionVector: string;
    updateData: string;
  };
}

async function resetClient(input: {
  databaseName: string;
  document: SyncDocument;
  oldDocumentId: string;
  oldOrganizationId: string;
  replacementOrganizationId: string;
  replacementRootContainerId: string;
}): Promise<RecoveryClient> {
  const { close, execSql } = await createTestExecSql(input.databaseName);
  await ensureSqlTables(execSql, clientSqlTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const version = encodeVersionVector(input.document);
  await db.insert(containers).values({
    id: OLD_CONTAINER_ID,
    organizationId: input.oldOrganizationId,
    parentId: null,
    metadataDocumentId: null,
    systemSlot: "root",
    localCreatedAt: STALE,
    localUpdatedAt: STALE,
  });
  await db.insert(documents).values({
    appKind: "documents",
    localId: LOCAL_ID,
    documentId: input.oldDocumentId,
    snapshotEndVersion: version,
    updatedAt: STALE,
  });
  await db.insert(documentHistoryCheckpoints).values({
    appKind: "documents",
    localId: LOCAL_ID,
    snapshot: bytesToBase64(exportFullHistorySnapshot(input.document)),
    endVersionVector: version,
    revision: crypto.randomUUID(),
    updatedAt: STALE,
  });
  await db.insert(documentProjection).values({
    localId: LOCAL_ID,
    documentId: input.oldDocumentId,
    containerId: OLD_CONTAINER_ID,
    organizationId: input.oldOrganizationId,
    documentKind: "note",
    title: "Shared note",
    updatedAt: STALE,
  });

  await clearRemoteSyncState(execSql, {
    organizationId: input.oldOrganizationId,
    replacement: {
      organizationId: input.replacementOrganizationId,
      rootContainerId: input.replacementRootContainerId,
    },
  });

  const [record] = await db.select().from(documents);
  expect(record).toEqual(
    expect.objectContaining({
      documentId: null,
      recoveryDocumentId: input.oldDocumentId,
    }),
  );
  const [pending] = await db.select().from(documentPendingUpdates);
  if (!pending?.id) throw new Error("Expected reset to queue local history");
  return {
    close,
    execSql,
    pending: {
      id: pending.id,
      partialEndVersionVector: pending.partialEndVersionVector,
      partialStartVersionVector: pending.partialStartVersionVector,
      updateData: pending.updateData,
    },
  };
}

function decryptedPendingUpdate(client: RecoveryClient) {
  return {
    ...client.pending,
    updateData: base64ToBytes(client.pending.updateData),
  };
}

async function createAdoptionServer(containerId: string) {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId,
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveProjectionUserKey = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const server: {
    committedProjection: DocumentWriterProjectionResponse | null;
    createCount: number;
  } = { committedProjection: null, createCount: 0 };
  const apiClient = createMockApiClient({
    createDocument: async () => null,
    createDocumentResult: async (request: DocumentCreateRequest) => {
      if (server.committedProjection) {
        return {
          kind: "http",
          method: "POST",
          path: "/documents",
          statusText: "Conflict",
          code: DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
          message:
            "POST /documents: 409 Conflict: Document manifest already exists",
          ok: false as const,
          report: () => undefined,
          status: 409,
        };
      }
      const response = await createResponseFromRequest(request);
      server.committedProjection = documentWriterProjectionFromCreateResponse({
        containerProjection: projection,
        response,
      });
      server.createCount += 1;
      return { data: response, ok: true as const };
    },
    getContainerWriterProjection: async () => projection,
    getDocumentWriterProjection: async (documentId: string) =>
      server.committedProjection?.documentId === documentId
        ? server.committedProjection
        : null,
    primeDocumentWriterProjection: () => undefined,
  });

  return {
    organizationId: author.organizationId,
    async createThenAdopt(
      firstExecSql: ExecSql,
      secondExecSql: ExecSql,
      documentId: string,
    ) {
      const common = {
        apiClient,
        author,
        containerId,
        documentId,
        resolveProjectionUserKey,
        signedAt: "2026-08-29T00:00:00.000Z",
        targetSecretKey: keyPair.secretKey,
      };
      const created = await createRemoteDocument({
        ...common,
        execSql: firstExecSql,
      });
      const adopted = await createRemoteDocument({
        ...common,
        execSql: secondExecSql,
      });
      if (!created || !adopted) {
        throw new Error("Expected recovered document creation and adoption");
      }
      expect(server.createCount).toBe(1);
      expect(created.documentId).toBe(documentId);
      expect(adopted.documentId).toBe(documentId);
      expect(adopted.response).toBeUndefined();
      expect(Array.from(adopted.contentKey)).toEqual(
        Array.from(created.contentKey),
      );
    },
  };
}

test("two reset clients recreate one remote document and converge their Loro histories", async () => {
  const oldOrganizationId = crypto.randomUUID();
  const oldDocumentId = crypto.randomUUID();
  const replacementRootContainerId = crypto.randomUUID();
  const adoptionServer = await createAdoptionServer(OLD_CONTAINER_ID);
  const baseline = await createDocument("pre-purge-baseline");
  baseline.getText("text").update("base");
  baseline.commit();
  const leftDocument = await createDocument("split-view-left");
  const rightDocument = await createDocument("split-view-right");
  importSnapshot(leftDocument, exportFullHistorySnapshot(baseline));
  importSnapshot(rightDocument, exportFullHistorySnapshot(baseline));
  leftDocument.getText("text").insert(0, "left ");
  leftDocument.commit();
  rightDocument.getText("text").insert(4, " right");
  rightDocument.commit();

  const left = await resetClient({
    databaseName: "split-view-recovery-left",
    document: leftDocument,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId: adoptionServer.organizationId,
    replacementRootContainerId,
  });
  const right = await resetClient({
    databaseName: "split-view-recovery-right",
    document: rightDocument,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId: adoptionServer.organizationId,
    replacementRootContainerId,
  });
  try {
    await adoptionServer.createThenAdopt(
      left.execSql,
      right.execSql,
      oldDocumentId,
    );
    const leftUpdate = decryptedPendingUpdate(left);
    const rightUpdate = decryptedPendingUpdate(right);
    const leftRecovered = await createDocument("left-recovered");
    const rightRecovered = await createDocument("right-recovered");
    importUpdates(leftRecovered, [leftUpdate.updateData]);
    importUpdates(rightRecovered, [rightUpdate.updateData]);

    await validateDocumentSyncUpdateImports({
      currentDocument: leftRecovered,
      decryptedUpdates: [rightUpdate],
    });
    await validateDocumentSyncUpdateImports({
      currentDocument: rightRecovered,
      decryptedUpdates: [leftUpdate],
    });
    importDecryptedDocumentSyncUpdates(leftRecovered, [rightUpdate]);
    importDecryptedDocumentSyncUpdates(rightRecovered, [leftUpdate]);

    expect(getTextValue(leftRecovered)).toContain("left ");
    expect(getTextValue(leftRecovered)).toContain(" right");
    expect(getTextValue(rightRecovered)).toBe(getTextValue(leftRecovered));
    expect(
      versionVectorsEqual(
        encodeVersionVector(leftRecovered),
        encodeVersionVector(rightRecovered),
      ),
    ).toBe(true);
    expect(exportFullHistoryIdentity(leftRecovered)).toBe(
      exportFullHistoryIdentity(rightRecovered),
    );
  } finally {
    left.close();
    right.close();
  }
});

test("reset history with a same-peer collision is quarantined before live import", async () => {
  const oldOrganizationId = crypto.randomUUID();
  const oldDocumentId = crypto.randomUUID();
  const replacementOrganizationId = crypto.randomUUID();
  const replacementRootContainerId = crypto.randomUUID();
  const genuine = await createDocument("split-view-colliding-peer");
  const collision = await createDocument("split-view-colliding-peer");
  genuine.getText("text").update("genuine pane update");
  genuine.commit();
  collision.getText("text").update("colliding pane edit");
  collision.commit();
  const genuineIdentity = exportFullHistoryIdentity(genuine);

  const left = await resetClient({
    databaseName: "split-view-collision-left",
    document: genuine,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId,
    replacementRootContainerId,
  });
  const right = await resetClient({
    databaseName: "split-view-collision-right",
    document: collision,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId,
    replacementRootContainerId,
  });
  try {
    const leftRecovered = await createDocument("collision-recovered-left");
    importUpdates(leftRecovered, [decryptedPendingUpdate(left).updateData]);
    let isolated: unknown;
    try {
      await validateDocumentSyncUpdateImports({
        currentDocument: leftRecovered,
        decryptedUpdates: [decryptedPendingUpdate(right)],
      });
    } catch (error) {
      isolated = error;
    }

    expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
    if (!isDocumentSyncUpdateIsolationError(isolated)) return;
    expect(isolated.attribution).toBe("update");
    expect(isolated.stage).toBe("loro_import");
    expect(isolated.message).toContain("already-covered frontier");
    expect(exportFullHistoryIdentity(leftRecovered)).toBe(genuineIdentity);
    expect(getTextValue(leftRecovered)).toBe("genuine pane update");
  } finally {
    left.close();
    right.close();
  }
});

test("same-page same-peer collisions are quarantined at batch scope", async () => {
  const oldOrganizationId = crypto.randomUUID();
  const oldDocumentId = crypto.randomUUID();
  const replacementOrganizationId = crypto.randomUUID();
  const replacementRootContainerId = crypto.randomUUID();
  const leftDocument = await createDocument("same-page-colliding-peer");
  const rightDocument = await createDocument("same-page-colliding-peer");
  leftDocument.getText("text").update("left pane update");
  leftDocument.commit();
  rightDocument.getText("text").update("right pane edit");
  rightDocument.commit();

  const left = await resetClient({
    databaseName: "same-page-collision-left",
    document: leftDocument,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId,
    replacementRootContainerId,
  });
  const right = await resetClient({
    databaseName: "same-page-collision-right",
    document: rightDocument,
    oldDocumentId,
    oldOrganizationId,
    replacementOrganizationId,
    replacementRootContainerId,
  });
  const current = await createDocument("same-page-collision-current");
  const currentIdentity = exportFullHistoryIdentity(current);
  try {
    let isolated: unknown;
    try {
      await validateDocumentSyncUpdateImports({
        currentDocument: current,
        decryptedUpdates: [
          decryptedPendingUpdate(left),
          decryptedPendingUpdate(right),
        ],
      });
    } catch (error) {
      isolated = error;
    }

    expect(isDocumentSyncUpdateIsolationError(isolated)).toBe(true);
    if (!isDocumentSyncUpdateIsolationError(isolated)) return;
    expect(isolated.attribution).toBe("batch");
    expect(isolated.stage).toBe("loro_import");
    expect(isolated.message).toContain("already-covered frontier");
    expect(exportFullHistoryIdentity(current)).toBe(currentIdentity);
  } finally {
    current.free();
    left.close();
    right.close();
  }
});
