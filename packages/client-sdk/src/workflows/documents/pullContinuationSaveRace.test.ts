import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "./historyContent";
import { persistDocumentState } from "./persistence";

test("a stale local save rebases content before adopting advanced pull progress", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-save-race",
  );
  const oldContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const advancedContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "page-3",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const remoteDocument = await createDocument("pull-save-race-remote");
    remoteDocument.getText("text").insert(0, "base");
    remoteDocument.commit();
    const baseSnapshot = exportFullHistorySnapshot(remoteDocument);
    const baseVersion = encodeVersionVector(remoteDocument);
    const localDocument = await createDocument("pull-save-race-local");
    importSnapshot(localDocument, baseSnapshot);
    localDocument.getText("text").insert(4, " local");
    localDocument.commit();
    const localVersion = encodeVersionVector(localDocument);
    const localUpdate = exportUpdatesSince(localDocument, baseVersion);
    remoteDocument.getText("text").insert(4, " remote");
    remoteDocument.commit();
    const remoteVersion = encodeVersionVector(remoteDocument);
    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "remote-1",
      effectiveAccessLevel: "read" as const,
      id: "local-1",
      pullContinuation: oldContinuation,
      snapshotEndVersion: baseVersion,
      text: "base",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...staleRecord,
      accessEpoch: 2,
      accessStateHash: "rotated-access-state",
      contentKeyBundle: "rotated-content-key-bundle",
      documentKekTargets: "rotated-kek-targets",
      documentManifestBundle: "rotated-manifest",
      lastCommitLsn: "0/3",
      pullContinuation: advancedContinuation,
      snapshotEndVersion: remoteVersion,
      text: getTextValue(remoteDocument),
    });
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: remoteVersion,
      force: true,
      localId: staleRecord.id,
      snapshot: bytesToBase64(exportFullHistorySnapshot(remoteDocument)),
    });

    const saved = await persistDocumentState({
      currentDoc: localDocument,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      historyUpdateOrigin: "local",
      historyUpdates: [bytesToBase64(localUpdate)],
      localId: staleRecord.id,
      patch: { snapshotEndVersion: localVersion },
      persistence: sqlDocumentsPersistence,
    });

    expect(saved?.record.pullContinuation).toEqual(advancedContinuation);
    expect(saved?.record).toMatchObject({
      accessEpoch: 2,
      accessStateHash: "rotated-access-state",
      contentKeyBundle: "rotated-content-key-bundle",
      documentKekTargets: "rotated-kek-targets",
      documentManifestBundle: "rotated-manifest",
    });
    expect(getTextValue(localDocument)).toContain(" local");
    expect(getTextValue(localDocument)).toContain(" remote");
    expect(
      satisfiesVersionVector(saved?.record.snapshotEndVersion, localVersion),
    ).toBe(true);
    expect(
      satisfiesVersionVector(saved?.record.snapshotEndVersion, remoteVersion),
    ).toBe(true);
    const restored = await loadPersistedDocumentContent({
      execSql,
      localId: staleRecord.id,
      persistence: sqlDocumentsPersistence,
    });
    expect(restored && getTextValue(restored)).toContain(" local");
    expect(restored && getTextValue(restored)).toContain(" remote");
  } finally {
    close();
  }
});

test("a local write queued behind a relink cannot enter the replacement history", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-local-write-relink-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const staleDoc = await createDocument("document-relink-stale-pane");
    staleDoc.getText("text").update("old identity");
    staleDoc.commit();
    const staleVersion = encodeVersionVector(staleDoc);
    const localBaseVersion = staleVersion;
    staleDoc.getText("text").insert(12, " local edit");
    staleDoc.commit();
    const localUpdate = exportUpdatesSince(staleDoc, localBaseVersion);
    const replacementDoc = await createDocument("document-relink-replacement");
    replacementDoc.getText("text").update("replacement identity");
    replacementDoc.commit();
    const replacementVersion = encodeVersionVector(replacementDoc);
    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "remote-old",
      effectiveAccessLevel: "write" as const,
      id: "local-1",
      snapshotEndVersion: staleVersion,
      text: "old identity",
    };
    const replacementRecord = {
      ...staleRecord,
      accessEpoch: 2,
      documentId: "remote-replacement",
      snapshotEndVersion: replacementVersion,
      text: "replacement identity",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, replacementRecord);
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: replacementVersion,
      force: true,
      localId: staleRecord.id,
      snapshot: bytesToBase64(exportFullHistorySnapshot(replacementDoc)),
    });

    const saved = await persistDocumentState({
      currentDoc: staleDoc,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      historyUpdateOrigin: "local",
      historyUpdates: [bytesToBase64(localUpdate)],
      localId: staleRecord.id,
      patch: { snapshotEndVersion: encodeVersionVector(staleDoc) },
      persistence: sqlDocumentsPersistence,
    });

    expect(saved).toMatchObject({
      pullContinuationSuperseded: true,
      record: replacementRecord,
      syncIdentitySuperseded: true,
    });
    const restored = await loadPersistedDocumentContent({
      execSql,
      localId: staleRecord.id,
      persistence: sqlDocumentsPersistence,
    });
    expect(restored && getTextValue(restored)).toBe("replacement identity");
  } finally {
    close();
  }
});

test("an out-of-order document page cannot replace a later pane's progress", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-page-race",
  );
  const consumedContinuation = {
    commitLsn: "0/2",
    commitLsnMode: "tracked" as const,
    cursor: "page-2",
  };
  const staleNextContinuation = {
    commitLsn: "0/3",
    commitLsnMode: "tracked" as const,
    cursor: "page-3",
  };
  const durableNextContinuation = {
    commitLsn: "0/4",
    commitLsnMode: "tracked" as const,
    cursor: "page-4",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const stalePageDoc = await createDocument("document-page-stale-pane");
    stalePageDoc.getText("text").update("page three");
    stalePageDoc.commit();
    const laterPageDoc = await createDocument("document-page-later-pane");
    importSnapshot(laterPageDoc, exportFullHistorySnapshot(stalePageDoc));
    laterPageDoc.getText("text").update("page four");
    laterPageDoc.commit();

    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "remote-1",
      effectiveAccessLevel: "read" as const,
      id: "local-1",
      lastCommitLsn: "0/2",
      pullContinuation: consumedContinuation,
      snapshotEndVersion: encodeVersionVector(stalePageDoc),
      text: "page three",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...staleRecord,
      lastCommitLsn: "0/4",
      pullContinuation: durableNextContinuation,
      snapshotEndVersion: encodeVersionVector(laterPageDoc),
      text: "page four",
    });
    const laterSnapshot = bytesToBase64(
      exportFullHistorySnapshot(laterPageDoc),
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(laterPageDoc),
      force: true,
      localId: staleRecord.id,
      snapshot: laterSnapshot,
    });

    const settled = await persistDocumentState({
      currentDoc: stalePageDoc,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedSyncState: {
        pullContinuation: consumedContinuation,
        record: staleRecord,
      },
      localId: staleRecord.id,
      patch: {
        lastCommitLsn: "0/3",
        pullContinuation: staleNextContinuation,
        snapshotEndVersion: encodeVersionVector(stalePageDoc),
      },
      persistence: sqlDocumentsPersistence,
    });

    expect(settled?.pullContinuationSuperseded).toBe(true);
    expect(settled?.record).toMatchObject({
      lastCommitLsn: "0/4",
      pullContinuation: durableNextContinuation,
      snapshotEndVersion: encodeVersionVector(laterPageDoc),
      text: "page four",
    });
    expect(settled?.historyRestoreState?.snapshot).toBe(laterSnapshot);
    expect(stalePageDoc.getText("text").toString()).toBe("page three");
  } finally {
    close();
  }
});

test("a sync settlement cannot overwrite another pane's newer content frontiers", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-continuation-frontier-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const staleDoc = await createDocument("document-frontier-stale-pane");
    staleDoc.getText("text").update("before concurrent edit");
    staleDoc.commit();
    const concurrentDoc = await createDocument("document-frontier-newer-pane");
    importSnapshot(concurrentDoc, exportFullHistorySnapshot(staleDoc));
    concurrentDoc.getText("text").update(" plus concurrent edit");
    concurrentDoc.commit();
    const staleFrontier = encodeVersionVector(staleDoc);
    const concurrentFrontier = encodeVersionVector(concurrentDoc);
    const continuation = {
      commitLsn: "0/2",
      commitLsnMode: "tracked" as const,
      cursor: "page-2",
    };
    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "remote-1",
      effectiveAccessLevel: "write" as const,
      id: "local-1",
      lastCommitLsn: "0/2",
      pendingBaseVersion: staleFrontier,
      pullContinuation: continuation,
      snapshotEndVersion: staleFrontier,
      text: "before concurrent edit",
    };
    const durableRecord = {
      ...staleRecord,
      pendingBaseVersion: concurrentFrontier,
      snapshotEndVersion: concurrentFrontier,
      text: " plus concurrent edit",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, durableRecord);
    const concurrentSnapshot = bytesToBase64(
      exportFullHistorySnapshot(concurrentDoc),
    );
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: concurrentFrontier,
      force: true,
      localId: staleRecord.id,
      snapshot: concurrentSnapshot,
    });

    const settled = await persistDocumentState({
      currentDoc: staleDoc,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedSyncState: {
        pullContinuation: continuation,
        record: staleRecord,
      },
      localId: staleRecord.id,
      patch: {
        lastCommitLsn: "0/3",
        pendingBaseVersion: staleFrontier,
        pullContinuation: null,
        snapshotEndVersion: staleFrontier,
      },
      persistence: sqlDocumentsPersistence,
    });

    expect(settled?.pullContinuationSuperseded).toBe(true);
    expect(settled?.record).toMatchObject({
      pendingBaseVersion: concurrentFrontier,
      pullContinuation: continuation,
      snapshotEndVersion: concurrentFrontier,
    });
    expect(settled?.historyRestoreState?.snapshot).toBe(concurrentSnapshot);
    expect(staleDoc.getText("text").toString()).toBe("before concurrent edit");
  } finally {
    close();
  }
});

test("a page-one response cannot restore a relinked and rekeyed document", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pull-page-one-identity-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const staleDoc = await createDocument("document-page-one-stale");
    staleDoc.getText("text").update("stale page one");
    staleDoc.commit();
    const durableDoc = await createDocument("document-page-one-durable");
    durableDoc.getText("text").update("durable relink");
    durableDoc.commit();
    const staleRecord = {
      accessEpoch: 1,
      accessStateHash: "access-old",
      containerId: "container-old",
      contentKeyBundle: "content-key-old",
      documentId: "remote-1",
      documentKekTargets: "targets-old",
      documentManifestBundle: "manifest-old",
      id: "local-1",
      lastCommitLsn: "0/2",
      snapshotEndVersion: encodeVersionVector(staleDoc),
      text: "stale page one",
    };
    const durableRecord = {
      ...staleRecord,
      accessEpoch: 2,
      accessStateHash: "access-new",
      containerId: "container-new",
      contentKeyBundle: "content-key-new",
      documentKekTargets: "targets-new",
      documentManifestBundle: "manifest-new",
      lastCommitLsn: "0/4",
      snapshotEndVersion: encodeVersionVector(durableDoc),
      text: "durable relink",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, durableRecord);

    const settled = await persistDocumentState({
      currentDoc: staleDoc,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedSyncState: { pullContinuation: null, record: staleRecord },
      localId: staleRecord.id,
      patch: {
        accessStateHash: "access-old-response",
        contentKeyBundle: "content-key-old-response",
        lastCommitLsn: "0/3",
        pullContinuation: null,
      },
      persistence: sqlDocumentsPersistence,
    });

    expect(settled?.pullContinuationSuperseded).toBe(true);
    expect(settled?.record).toMatchObject(durableRecord);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, staleRecord.id),
    ).toMatchObject(durableRecord);
  } finally {
    close();
  }
});
