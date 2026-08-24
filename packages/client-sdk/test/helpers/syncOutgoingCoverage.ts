import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { ensureDocumentAttachmentStructure } from "../../src/data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { ensureDocumentRowsStructure } from "../../src/data/documents/documentRowList";
import { createDomainScope } from "../../src/data/domainScope";
import { ensureContainerTables } from "../../src/data/persistence/containers/containerPersistence";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import { noopDocumentStorePersistenceEffects } from "../../src/stores/documents/documentStore/documentStore.testFixtures";
import {
  createDocumentStoreState,
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "../../src/stores/documents/documentStore/state";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
} from "../../src/stores/documents/documentStore/syncGeneration";
import type { DocumentsRuntime } from "../../src/stores/documents/types";
import { enqueuePendingDocumentUpdate } from "../../src/workflows/documents";

interface CoverageFixture {
  baseVersion: string;
  close: () => void;
  document: DocumentState;
  documentVersion: string;
  execSql: DocumentsRuntime["infra"]["execSql"];
  generation: DocumentStoreSyncGeneration;
  localId: string;
  state: DocumentStoreState;
}

function createCoverageRuntime(
  name: string,
  execSql: DocumentsRuntime["infra"]["execSql"],
): DocumentsRuntime {
  return {
    apiClient: {},
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: null,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container-1",
      domainScope: createDomainScope(),
      events: [],
      online: true,
      peerScope: name,
    },
    util: {
      isRemoteSyncBlocked: () => false,
      log: () => undefined,
    },
  } as unknown as DocumentsRuntime;
}

export async function createCoverageFixture(
  name: string,
  queueUpdate: boolean,
): Promise<CoverageFixture> {
  const database = await createTestExecSql(name);
  await sqlDocumentsPersistence.ensureSchema(database.execSql);
  await ensureContainerTables(database.execSql);

  const document = await createDocument(`${name}-writer`);
  ensureDocumentAttachmentStructure(document);
  ensureDocumentRowsStructure(document);
  document.commit();
  const baseVersion = encodeVersionVector(document);
  document.getText("text").update("local edit");
  document.commit();
  const update = exportUpdatesSince(document, baseVersion);
  const documentVersion = encodeVersionVector(document);
  const localId = `${name}-local`;

  await sqlDocumentsPersistence.saveDocument(database.execSql, {
    accessEpoch: 1,
    containerId: "container-1",
    contentKeyBundle: "{}",
    documentId: "document-1",
    documentKekTargets: "{}",
    documentManifestBundle: "{}",
    id: localId,
    lastCommitLsn: "1",
    pendingBaseVersion: baseVersion,
    snapshotEndVersion: documentVersion,
    text: getTextValue(document),
  });
  if (queueUpdate) {
    await enqueuePendingDocumentUpdate({
      execSql: database.execSql,
      localId,
      persistence: sqlDocumentsPersistence,
      update,
    });
  }

  const runtime = createCoverageRuntime(name, database.execSql);
  const state = createDocumentStoreState(
    localId,
    runtime,
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    "document-1",
  );
  state.doc = document;
  state.initialized = true;
  state.pendingBaseVersion = baseVersion;
  state.record = await sqlDocumentsPersistence.loadDocument(
    database.execSql,
    localId,
  );
  setReadySnapshot(state, document, false);
  const generation = captureDocumentStoreSyncGeneration(state, document);
  if (!generation) {
    throw new Error("Expected a live document generation");
  }

  return {
    ...database,
    baseVersion,
    document,
    documentVersion,
    generation,
    localId,
    state,
  };
}
