import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getTextValue,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { ensureDocumentAttachmentStructure } from "../../../data/documents/documentContent";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { ensureDocumentRowsStructure } from "../../../data/documents/documentRowList";
import { createDomainScope } from "../../../data/domainScope";
import { ensureContainerTables } from "../../../data/persistence/containers/containerPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { listDeferredPendingWriteCandidates } from "../../../workflows/container-contents/pendingWrites/deferredTails";
import { enqueuePendingDocumentUpdate } from "../../../workflows/documents";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { persistDocument } from "./persistence";
import {
  createDocumentStoreState,
  resetDocumentStore,
  setReadySnapshot,
} from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { shouldSkipCleanScheduledDocumentSync } from "./syncShared";

async function createCoverageFixture(name: string, queueUpdate: boolean) {
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

  const runtime = {
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
      execSql: database.execSql,
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

test("queued coverage survives restart settlement without a deferred tail", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-restart",
    true,
  );
  try {
    const pendingUpdates = await sqlDocumentsPersistence.listPendingUpdates(
      fixture.execSql,
      fixture.localId,
    );
    const prepared = await prepareDocumentOutgoingCoverage({
      currentDoc: fixture.document,
      generation: fixture.generation,
      pendingUpdates,
      state: fixture.state,
    });
    expect(prepared).not.toBeNull();
    if (!prepared) return;

    expect(prepared.pendingUpdates).toHaveLength(1);
    expect(
      versionVectorsEqual(
        fixture.state.pendingBaseVersion,
        fixture.documentVersion,
      ),
    ).toBe(true);

    await persistDocument(
      fixture.state,
      fixture.document,
      {},
      { acceptedPendingUpdateIds: prepared.pendingUpdates.map(({ id }) => id) },
    );
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        fixture.execSql,
        fixture.localId,
      ),
    ).toHaveLength(0);
    expect(await listDeferredPendingWriteCandidates(fixture.execSql)).toEqual(
      [],
    );
  } finally {
    fixture.close();
  }
});

test("a zero-row deferred tail is materialized before clean skip", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-deferred",
    false,
  );
  try {
    const prepared = await prepareDocumentOutgoingCoverage({
      currentDoc: fixture.document,
      generation: fixture.generation,
      pendingUpdates: [],
      state: fixture.state,
    });
    expect(prepared).not.toBeNull();
    if (!prepared) return;

    expect(prepared.pendingUpdates).toHaveLength(1);
    expect(
      shouldSkipCleanScheduledDocumentSync({
        currentRecord: prepared.record,
        pendingUpdates: prepared.pendingUpdates,
        state: fixture.state,
      }),
    ).toBe(false);
    const [materialized] = prepared.pendingUpdates;
    expect(materialized).toBeDefined();
    expect(
      satisfiesVersionVector(
        fixture.baseVersion,
        materialized?.partialStartVersionVector ?? "",
      ),
    ).toBe(true);
    expect(
      versionVectorsEqual(
        materialized?.partialEndVersionVector ?? "",
        fixture.documentVersion,
      ),
    ).toBe(true);
    expect(
      versionVectorsEqual(
        fixture.state.pendingBaseVersion,
        fixture.documentVersion,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("the repair persist advances the frontier with the marker", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-frontier",
    false,
  );
  try {
    // Model a lagged record: the stored frontier is behind the live document
    // (e.g. after a recovery that never re-published it). The repair enqueues
    // the deferred delta and must advance BOTH the marker and the frontier —
    // a frontier left behind keeps the settled document listed (and primed)
    // as a deferred tail forever.
    await sqlDocumentsPersistence.saveDocument(fixture.execSql, {
      ...(fixture.state.record ?? {}),
      id: fixture.localId,
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      pendingBaseVersion: fixture.baseVersion,
      snapshotEndVersion: fixture.baseVersion,
      text: getTextValue(fixture.document),
    });
    fixture.state.record = await sqlDocumentsPersistence.loadDocument(
      fixture.execSql,
      fixture.localId,
    );

    const prepared = await prepareDocumentOutgoingCoverage({
      currentDoc: fixture.document,
      generation: fixture.generation,
      pendingUpdates: [],
      state: fixture.state,
    });
    expect(prepared).not.toBeNull();

    const durableRecord = await sqlDocumentsPersistence.loadDocument(
      fixture.execSql,
      fixture.localId,
    );
    expect(
      satisfiesVersionVector(
        durableRecord?.snapshotEndVersion ?? "",
        durableRecord?.pendingBaseVersion ?? "",
      ),
    ).toBe(true);
    expect(
      versionVectorsEqual(
        durableRecord?.snapshotEndVersion ?? "",
        fixture.documentVersion,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("preparation abandons a replaced store generation after enqueue", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-generation",
    false,
  );
  try {
    const replacementDoc = await createDocument("replacement-writer");
    replacementDoc.getText("text").update("replacement generation");
    replacementDoc.commit();
    const replacementBase = encodeVersionVector(replacementDoc);
    const replacementRecord = {
      ...fixture.state.record,
      pendingBaseVersion: replacementBase,
      text: "replacement generation",
    } as NonNullable<typeof fixture.state.record>;
    const persistence = fixture.state.persistence;
    fixture.state.persistence = {
      ...persistence,
      enqueuePendingUpdate: async (execSql, pendingUpdate) => {
        await persistence.enqueuePendingUpdate(execSql, pendingUpdate);
        resetDocumentStore(fixture.state);
        fixture.state.doc = replacementDoc;
        fixture.state.initialized = true;
        fixture.state.pendingBaseVersion = replacementBase;
        fixture.state.record = replacementRecord;
        setReadySnapshot(fixture.state, replacementDoc, false);
      },
    };

    const prepared = await prepareDocumentOutgoingCoverage({
      currentDoc: fixture.document,
      generation: fixture.generation,
      pendingUpdates: [],
      state: fixture.state,
    });

    expect(prepared).toBeNull();
    expect(fixture.state.doc).toBe(replacementDoc);
    expect(fixture.state.record).toBe(replacementRecord);
    expect(
      versionVectorsEqual(fixture.state.pendingBaseVersion, replacementBase),
    ).toBe(true);
    expect(fixture.state.snapshot.text).toBe("replacement generation");
  } finally {
    fixture.close();
  }
});

test("guarded persistence cannot publish into a replacement generation", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-persist-generation",
    true,
  );
  try {
    const replacementDoc = await createDocument("persist-replacement-writer");
    replacementDoc.getText("text").update("replacement snapshot");
    replacementDoc.commit();
    const replacementBase = encodeVersionVector(replacementDoc);
    const replacementRecord = {
      ...fixture.state.record,
      pendingBaseVersion: replacementBase,
      text: "replacement snapshot",
    } as NonNullable<typeof fixture.state.record>;
    let emitted = 0;
    let registered = 0;
    fixture.state.effects = {
      emitPersistedDocument: () => {
        emitted += 1;
      },
      registerDocumentIdentity: () => {
        registered += 1;
      },
    };
    const persistence = fixture.state.persistence;
    let releasePersist: () => void = () => undefined;
    const persistBlocked = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    let signalPersistStarted: () => void = () => undefined;
    const persistStarted = new Promise<void>((resolve) => {
      signalPersistStarted = resolve;
    });
    fixture.state.persistence = {
      ...persistence,
      saveDocument: async (execSql, document, options) => {
        signalPersistStarted();
        await persistBlocked;
        return persistence.saveDocument(execSql, document, options);
      },
    };

    const persistPromise = persistDocument(
      fixture.state,
      fixture.document,
      {},
      {},
      fixture.generation,
    );
    await persistStarted;
    resetDocumentStore(fixture.state);
    fixture.state.doc = replacementDoc;
    fixture.state.initialized = true;
    fixture.state.pendingBaseVersion = replacementBase;
    fixture.state.record = replacementRecord;
    setReadySnapshot(fixture.state, replacementDoc, false);
    let replacementWriteCompleted = false;
    const replacementWrite = persistDocument(
      fixture.state,
      replacementDoc,
    ).then((result) => {
      replacementWriteCompleted = true;
      return result;
    });
    await Promise.resolve();
    expect(replacementWriteCompleted).toBe(false);
    releasePersist();
    const [persisted] = await Promise.all([persistPromise, replacementWrite]);

    expect(persisted).toBeNull();
    expect(replacementWriteCompleted).toBe(true);
    expect(fixture.state.doc).toBe(replacementDoc);
    expect(fixture.state.record?.text).toBe("replacement snapshot");
    expect(fixture.state.snapshot.text).toBe("replacement snapshot");
    const durableRecord = await sqlDocumentsPersistence.loadDocument(
      fixture.execSql,
      fixture.localId,
    );
    expect(durableRecord?.text).toBe("replacement snapshot");
    expect(
      versionVectorsEqual(
        durableRecord?.pendingBaseVersion ?? "",
        replacementBase,
      ),
    ).toBe(true);
    expect(emitted).toBe(1);
    expect(registered).toBe(0);
  } finally {
    fixture.close();
  }
});
