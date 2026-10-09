import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";

const maintenanceRuntimes = new WeakMap<ExecSql, DocumentsRuntime>();

export async function createDiscardTestExecSql(name: string) {
  const connection = await createTestExecSql(name);
  return {
    execSql: connection.execSql,
    close: async () => {
      const runtime = maintenanceRuntimes.get(connection.execSql);
      if (runtime) await reclaimDocumentOrphanBlobs(runtime);
      connection.close();
    },
  };
}

export interface RecordedProjectionDelete {
  documentKind: string;
  localId: string;
}

function createRuntime(
  execSql: ExecSql,
  deletedBlobStorageKeys: string[] = [],
  projectionDeletes: RecordedProjectionDelete[] = [],
): DocumentsRuntime {
  return {
    infra: {
      blobStore: {
        deleteBytes: async (storageKey: string) => {
          deletedBlobStorageKeys.push(storageKey);
        },
        openByteSource: async () => null,
      },
      dbStatus: "ready",
      documentProjectors: {
        ...defaultDocumentProjectorRegistry,
        deleteStoredDocumentClientProjection: async (input: {
          documentKind: string;
          localId: string;
        }) => {
          projectionDeletes.push({
            documentKind: input.documentKind,
            localId: input.localId,
          });
        },
      },
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: { domainScope: createDomainScope() },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
}

export async function saveSyncedDocumentRecord(
  execSql: ExecSql,
  localId: string,
  documentId: string | null,
  containerId: string | null,
): Promise<void> {
  await sqlDocumentsPersistence.saveDocument(execSql, {
    id: localId,
    accessEpoch: 3,
    accessStateHash: "state-hash",
    containerId,
    contentKeyBundle: "content-key-bundle",
    documentId,
    documentKind: "note",
    documentKekTargets: "kek-targets",
    documentManifestBundle: "manifest-bundle",
    effectiveAccessLevel: "admin",
    lastCommitLsn: "42",
    pendingBaseVersion: "base-version",
    pullContinuation: {
      commitLsn: "0/2",
      commitLsnMode: "tracked",
      cursor: "page-2",
    },
    recoveryGeneration: 1,
    snapshotEndVersion: "synced-end-version",
    text: "hello",
    title: "Stuck note",
  });
}

export function createStoreState(
  execSql: ExecSql,
  localId: string,
  deletedBlobStorageKeys: string[] = [],
  projectionDeletes: RecordedProjectionDelete[] = [],
) {
  const state = createDocumentStoreState(
    localId,
    createRuntime(execSql, deletedBlobStorageKeys, projectionDeletes),
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
  );
  maintenanceRuntimes.set(execSql, state.runtime);
  state.initialized = true;
  return state;
}
