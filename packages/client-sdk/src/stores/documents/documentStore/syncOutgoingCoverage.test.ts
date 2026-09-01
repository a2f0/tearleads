import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  getImportBlobMetadata,
  getTextValue,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createCoverageFixture } from "../../../../test/helpers/syncOutgoingCoverage";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { listDeferredPendingWriteCandidates } from "../../../workflows/container-contents/pendingWrites/deferredTails";
import { pendingDeltaSinceBase, persistDocument } from "./persistence";
import { resetDocumentStore, setReadySnapshot } from "./state";
import { shouldReArmDocumentSync } from "./syncFinalize";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { shouldSkipCleanScheduledDocumentSync } from "./syncShared";

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

test("a durable cursor after a 64-update page bypasses the clean lane skip", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-pull-cursor",
    false,
  );
  try {
    const currentRecord = fixture.state.record;
    if (!currentRecord) throw new Error("Expected a persisted document record");
    expect(
      shouldSkipCleanScheduledDocumentSync({
        currentRecord,
        pendingUpdates: [],
        state: fixture.state,
      }),
    ).toBe(true);
    expect(
      shouldSkipCleanScheduledDocumentSync({
        currentRecord: {
          ...currentRecord,
          pullContinuationRecoveryRequired: true,
        },
        pendingUpdates: [],
        state: fixture.state,
      }),
    ).toBe(false);

    await persistDocument(fixture.state, fixture.document, {
      pullContinuation: {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "page-after-update-64",
      },
    });
    expect(
      shouldSkipCleanScheduledDocumentSync({
        currentRecord,
        pendingUpdates: [],
        state: fixture.state,
      }),
    ).toBe(false);

    await persistDocument(fixture.state, fixture.document, {
      lastCommitLsn: "0/3",
      pullContinuation: null,
    });
    expect(fixture.state.record?.pullContinuation).toBeNull();

    await persistDocument(fixture.state, fixture.document, {
      pullContinuation: {
        commitLsn: "0/3",
        commitLsnMode: "tracked",
        cursor: "replacement-page",
      },
    });
    await persistDocument(fixture.state, fixture.document, { accessEpoch: 2 });
    expect(fixture.state.pullContinuation).toBeNull();
  } finally {
    fixture.close();
  }
});

test("a completed cursor re-arms queued document writes", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-cursor-complete",
    false,
  );
  try {
    expect(
      shouldReArmDocumentSync(fixture.state, {
        consumedPullContinuation: null,
        outgoingUpdateCount: 1,
        requestRecord: fixture.state.record as NonNullable<
          typeof fixture.state.record
        >,
        synced: {
          acceptedRecoveryBaseline: false,
          exhaustedPendingUpdateCount: 0,
          hasDeferredPendingUpdates: true,
          hasIncompletePull: false,
          rekeyedPendingUpdateIds: [],
          settledPendingUpdateIds: [],
        } as never,
      }),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("a superseded pull restores the durable outgoing base in the live store", async () => {
  const fixture = await createCoverageFixture(
    "outgoing-coverage-superseded-pull",
    false,
  );
  const consumedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const durableContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "page-3",
  };
  try {
    const loadedRecord = fixture.state.record;
    if (!loadedRecord) throw new Error("Expected a persisted document record");
    const requestRecord = {
      ...loadedRecord,
      lastCommitLsn: "0/2",
      pendingBaseVersion: fixture.baseVersion,
      pullContinuation: consumedContinuation,
    };
    fixture.state.record = requestRecord;
    fixture.state.pullContinuation = consumedContinuation;
    fixture.state.pendingBaseVersion = fixture.baseVersion;
    let emitted = 0;
    fixture.state.effects = {
      ...fixture.state.effects,
      emitPersistedDocument: () => {
        emitted += 1;
      },
    };
    await sqlDocumentsPersistence.saveDocument(fixture.execSql, {
      ...requestRecord,
      lastCommitLsn: "0/3",
      pendingBaseVersion: fixture.documentVersion,
      pullContinuation: durableContinuation,
    });

    const persisted = await persistDocument(
      fixture.state,
      fixture.document,
      {
        lastCommitLsn: "0/2A",
        pullContinuation: null,
      },
      {
        expectedSyncState: {
          pullContinuation: consumedContinuation,
          record: requestRecord,
        },
      },
    );

    expect(persisted?.pullContinuationSuperseded).toBe(true);
    expect(persisted?.updatedAt).toBeUndefined();
    expect(emitted).toBe(0);
    expect(fixture.state.pullContinuation).toEqual(durableContinuation);
    expect(
      versionVectorsEqual(
        fixture.state.pendingBaseVersion,
        fixture.documentVersion,
      ),
    ).toBe(true);
    const pendingDelta = getImportBlobMetadata(
      pendingDeltaSinceBase(fixture.state, fixture.document),
    );
    expect(
      versionVectorsEqual(
        pendingDelta.partialStartVersionVector,
        pendingDelta.partialEndVersionVector,
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
      enqueuePendingUpdate: async (execSql, pendingUpdate, options) => {
        const enqueued = await persistence.enqueuePendingUpdate(
          execSql,
          pendingUpdate,
          options,
        );
        resetDocumentStore(fixture.state);
        fixture.state.doc = replacementDoc;
        fixture.state.initialized = true;
        fixture.state.pendingBaseVersion = replacementBase;
        fixture.state.record = replacementRecord;
        setReadySnapshot(fixture.state, replacementDoc, false);
        return enqueued;
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
      commitDocumentMutation: async (execSql, input, saveProjection) => {
        signalPersistStarted();
        await persistBlocked;
        return persistence.commitDocumentMutation(
          execSql,
          input,
          saveProjection,
        );
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
