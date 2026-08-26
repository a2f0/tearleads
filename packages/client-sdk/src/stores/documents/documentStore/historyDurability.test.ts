import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
  satisfiesVersionVector,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { DOCUMENT_HISTORY_COMPACTION_MAX_ROWS } from "../../../data/sqlite/documentHistoryPersistence";
import { openHistoryTestStore as openStore } from "./historyDurability.testFixtures";
import { setDocumentText } from "./mutations";
import {
  listPendingUpdates,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";

test("a document created offline is fully durable from birth", async () => {
  const { close, execSql } = await createTestExecSql("history-birth");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // Creation is the ONLY persist this document sees before the "restart".
    await openStore(
      execSql,
      "born-offline",
      sqlDocumentsPersistence,
      "created and closed",
    );

    const reopened = await openStore(
      execSql,
      "born-offline",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("created and closed");
    const pendingUpdates = await listPendingUpdates(reopened);
    expect(pendingUpdates).toHaveLength(1);
    expect(
      satisfiesVersionVector(
        pendingUpdates[0]?.partialEndVersionVector ?? "",
        encodeVersionVector(reopened.doc),
      ),
    ).toBe(true);
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("compaction deletes only the tail rows captured before its export", async () => {
  const { close, execSql } = await createTestExecSql("history-covered-ids");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "raced-doc",
      updates: ["covered-row"],
    });
    const coveredTailIds = (
      (await sqlDocumentsPersistence.listHistoryTailEntries?.(
        execSql,
        "raced-doc",
      )) ?? []
    ).map((entry) => entry.id);
    // A concurrent append lands after the capture (and after the export it
    // models); the replacement must leave it for the next compaction.
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "raced-doc",
      updates: ["late-row"],
    });
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds,
      endVersionVector: emptyVersionVector(),
      localId: "raced-doc",
      snapshot: "checkpoint",
    });

    const tail = await sqlDocumentsPersistence.readHistoryTailSize?.(
      execSql,
      "raced-doc",
    );
    expect(tail).toMatchObject({ hasCheckpoint: true, rowCount: 1 });
  } finally {
    close();
  }
});

test("full history survives a restart via the checkpoint and tail", async () => {
  const { close, execSql } = await createTestExecSql("history-durability");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const first = await openStore(
      execSql,
      "history-doc",
      sqlDocumentsPersistence,
    );
    await setDocumentText(first, () => undefined, "first line");
    await setDocumentText(first, () => undefined, "first line and more");

    const reopened = await openStore(
      execSql,
      "history-doc",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("first line and more");
    // The whole point: a restarted device can still export the full-history
    // baselines that heals, rotations, and unlinks require.
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("the tail compacts into a fresh checkpoint past the row threshold", async () => {
  const { close, execSql } = await createTestExecSql("history-compaction");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(
      execSql,
      "compaction-doc",
      sqlDocumentsPersistence,
    );
    await setDocumentText(state, () => undefined, "seed");

    if (!state.doc) throw new Error("expected live doc");
    const coveredUpdate = bytesToBase64(exportAllUpdates(state.doc));
    // Inflate the tail past the threshold with exact duplicate history. Every
    // row is safe to retire into the checkpoint.
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "compaction-doc",
      updates: Array.from(
        { length: DOCUMENT_HISTORY_COMPACTION_MAX_ROWS },
        () => coveredUpdate,
      ),
    });
    await persistDocument(state, state.doc);

    const tail = await sqlDocumentsPersistence.readHistoryTailSize?.(
      execSql,
      "compaction-doc",
    );
    expect(tail).toMatchObject({ hasCheckpoint: true, rowCount: 0 });
  } finally {
    close();
  }
});

test("restored remote tail rows advance the marker; local rows do not", async () => {
  const { close, execSql } = await createTestExecSql("history-tail-origin");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    // Synced baseline: checkpoint + record whose durable marker sits at it.
    const writer = await createDocument("origin-writer");
    writer.getText("text").update("base");
    writer.commit();
    const baseVersion = encodeVersionVector(writer);
    const baseline = exportFullHistorySnapshot(writer);
    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: baseVersion,
      force: true,
      localId: "origin-doc",
      snapshot: bytesToBase64(baseline),
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "origin-doc",
      accessEpoch: 1,
      containerId: null,
      documentId: "origin-remote-id",
      pendingBaseVersion: baseVersion,
      snapshotEndVersion: baseVersion,
      text: "base",
    });

    // Crash-window shape: a pulled REMOTE update reached the tail but the
    // record (and its marker) was never re-persisted...
    const remotePeer = await createDocument("origin-remote-peer");
    importSnapshot(remotePeer, baseline);
    remotePeer.getText("text").update("base remote");
    remotePeer.commit();
    const remoteDelta = exportUpdatesSince(remotePeer, baseVersion);
    const remoteEnd = encodeVersionVector(remotePeer);
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: "origin-doc",
      origin: "remote",
      updates: [bytesToBase64(remoteDelta)],
    });

    // ...alongside a LOCAL deferred edit whose op was never enqueued.
    writer.getText("text").update("base local");
    writer.commit();
    const localDelta = exportUpdatesSince(writer, baseVersion);
    const localEnd = encodeVersionVector(writer);
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: "origin-doc",
      origin: "local",
      updates: [bytesToBase64(localDelta)],
    });

    const reopened = await openStore(
      execSql,
      "origin-doc",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc || reopened.pendingBaseVersion === null) {
      throw new Error("expected restored doc and marker");
    }
    // Content restored from both rows either way.
    expect(getTextValue(reopened.doc)).toContain("remote");
    expect(getTextValue(reopened.doc)).toContain("local");
    // The marker advanced across the remote row (its ops are already
    // server-side, so they are never re-sent)...
    expect(satisfiesVersionVector(reopened.pendingBaseVersion, remoteEnd)).toBe(
      true,
    );
    // ...but NOT across the local row: the next edit must re-derive and send
    // that op.
    expect(satisfiesVersionVector(reopened.pendingBaseVersion, localEnd)).toBe(
      false,
    );
  } finally {
    close();
  }
});

test("a tail-only scope (crash before the birth checkpoint) still restores", async () => {
  const { close, execSql } = await createTestExecSql("history-tail-only");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    // Model the crash window: the first edit's tail row landed (the enqueue
    // dual-write) and the record persisted, but the birth checkpoint never
    // did. The tail row is the only durable copy of the edit.
    const author = await createDocument("tail-only-author");
    author.getText("text").update("only durable copy");
    author.commit();
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "tail-only-doc",
      updates: [bytesToBase64(exportAllUpdates(author))],
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "tail-only-doc",
      accessEpoch: 1,
      containerId: null,
      documentId: null,
      snapshotEndVersion: encodeVersionVector(author),
      text: "only durable copy",
    });

    const reopened = await openStore(
      execSql,
      "tail-only-doc",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("only durable copy");
  } finally {
    close();
  }
});

test("compaction preserves cross-pane tail rows its document does not cover", async () => {
  const { close, execSql } = await createTestExecSql("history-cross-pane");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(
      execSql,
      "cross-pane-doc",
      sqlDocumentsPersistence,
    );
    await setDocumentText(state, () => undefined, "pane A edit");

    // A second pane's edit: real ops this pane's document has NOT merged.
    const paneB = await createDocument("pane-b-peer");
    paneB.getText("text").update("pane B edit");
    paneB.commit();
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "cross-pane-doc",
      updates: [bytesToBase64(exportAllUpdates(paneB))],
    });
    if (!state.doc) throw new Error("expected live doc");
    const paneAUpdate = bytesToBase64(exportAllUpdates(state.doc));
    // Push past the threshold with exact duplicate pane-A history.
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "cross-pane-doc",
      updates: Array.from(
        { length: DOCUMENT_HISTORY_COMPACTION_MAX_ROWS },
        () => paneAUpdate,
      ),
    });
    await persistDocument(state, state.doc);

    // The foreign row survives — deleting it would discard the only durable
    // copy of pane B's ops.
    const remaining =
      (await sqlDocumentsPersistence.listHistoryTailEntries?.(
        execSql,
        "cross-pane-doc",
      )) ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.updateData).toBe(
      bytesToBase64(exportAllUpdates(paneB)),
    );
  } finally {
    close();
  }
});

test("a deferred write covered by the tail restores with full history", async () => {
  const { close, execSql } = await createTestExecSql("history-deferred-tail");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(
      execSql,
      "deferred-covered-doc",
      sqlDocumentsPersistence,
    );
    await setDocumentText(state, () => undefined, "enqueued edit");
    if (!state.doc) throw new Error("expected live doc");

    // The deferRemoteSync shape: mutate, append the delta to the history
    // tail, persist — but never enqueue or advance the marker (the op is
    // re-derived by the next edit).
    state.doc.getText("text").update("enqueued edit plus deferred");
    state.doc.commit();
    const deferredDelta = pendingDeltaSinceBase(state, state.doc);
    await sqlDocumentsPersistence.appendHistoryUpdates?.(execSql, {
      origin: "local",
      localId: "deferred-covered-doc",
      updates: [bytesToBase64(deferredDelta)],
    });
    await persistDocument(state, state.doc);

    const reopened = await openStore(
      execSql,
      "deferred-covered-doc",
      sqlDocumentsPersistence,
    );
    if (!reopened.doc) throw new Error("expected restored doc");
    expect(getTextValue(reopened.doc)).toBe("enqueued edit plus deferred");
    // Because the tail covers the deferred delta, the restore keeps full
    // history including the deferred op.
    expect(() => {
      if (!reopened.doc) throw new Error("expected restored doc");
      exportFullHistorySnapshot(reopened.doc);
    }).not.toThrow();
  } finally {
    close();
  }
});

test("a stale compactor cannot regress a newer checkpoint", async () => {
  const { close, execSql } = await createTestExecSql("history-stale-compactor");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const advanced = await createDocument("advanced-pane");
    advanced.getText("text").update("advanced state");
    advanced.commit();
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(advanced),
      localId: "contested-doc",
      snapshot: "advanced-checkpoint",
    });

    // A pane with disjoint, unmerged ops must not replace the newer
    // checkpoint — the advanced pane's tail rows may already be deleted, so
    // regressing would leave its ops with no durable copy.
    const stale = await createDocument("stale-pane");
    stale.getText("text").update("divergent");
    stale.commit();
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(stale),
      localId: "contested-doc",
      snapshot: "stale-checkpoint",
    });

    const restored = await sqlDocumentsPersistence.loadHistoryRestoreState?.(
      execSql,
      "contested-doc",
    );
    expect(restored?.snapshot).toBe("advanced-checkpoint");

    // A creation retry force-replaces the orphan of a failed prior attempt,
    // even though its fresh document does not dominate it.
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(stale),
      force: true,
      localId: "contested-doc",
      snapshot: "creation-retry-checkpoint",
    });
    expect(
      (
        await sqlDocumentsPersistence.loadHistoryRestoreState?.(
          execSql,
          "contested-doc",
        )
      )?.snapshot,
    ).toBe("creation-retry-checkpoint");
  } finally {
    close();
  }
});

test("deleting a document deletes its history checkpoint and tail", async () => {
  const { close, execSql } = await createTestExecSql("history-delete");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const state = await openStore(
      execSql,
      "deleted-doc",
      sqlDocumentsPersistence,
    );
    await setDocumentText(state, () => undefined, "short lived");
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState?.(
        execSql,
        "deleted-doc",
      ),
    ).not.toBeNull();

    await sqlDocumentsPersistence.deleteDocument(execSql, "deleted-doc");
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState?.(
        execSql,
        "deleted-doc",
      ),
    ).toBeNull();
  } finally {
    close();
  }
});
