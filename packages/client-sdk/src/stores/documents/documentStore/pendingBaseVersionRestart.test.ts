import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { loadPersistedDocumentContent } from "../../../workflows/documents";

const LOCAL_ID = "self-contact";

// Regression for #1240 item 1: a device-first `deferRemoteSync` field write
// persists the snapshot at a version AHEAD of the durable outgoing-delta marker
// it deliberately leaves un-advanced (the op is re-derived by the next edit). If
// a restart re-seeds the marker to the loaded snapshot version it moves PAST the
// deferred op, permanently dropping it from sync. Persisting the marker and
// restoring it on init keeps the re-derive-on-next-write mechanism working
// across a restart.
test("a device-first deferRemoteSync write survives a restart and still syncs", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-base-version-restart",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    // Author a synced baseline and advance the durable marker past it.
    const writer = await createDocument("writer");
    writer.getMap("meta").set("displayName", "Ada");
    writer.commit();
    const syncedMarker = encodeVersionVector(writer);

    // A peer that already holds the synced baseline.
    const peer = await createDocument("peer");
    importUpdates(peer, [exportUpdatesSince(writer, undefined)]);
    expect(peer.getMap("meta").get("displayName")).toBe("Ada");

    // Device-first deferRemoteSync field write: mutate the content but leave the
    // marker un-advanced and nothing enqueued (mirrors the deferred branch of
    // queueDocumentStructuredFieldWrite). The store persists the content into
    // the durable history with the retained (behind) marker on the record.
    writer.getMap("meta").set("isSelf", true);
    writer.commit();
    await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
      coveredTailIds: [],
      endVersionVector: encodeVersionVector(writer),
      force: true,
      localId: LOCAL_ID,
      snapshot: bytesToBase64(exportFullHistorySnapshot(writer)),
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: LOCAL_ID,
      containerId: "system-container",
      documentId: null,
      text: "",
      snapshotEndVersion: encodeVersionVector(writer),
      accessEpoch: 1,
      pendingBaseVersion: syncedMarker,
    });

    // --- simulated restart: reload from persistence ---
    const loaded = await sqlDocumentsPersistence.loadDocument(
      execSql,
      LOCAL_ID,
    );
    // The behind-marker round-trips instead of being re-seeded to the persisted
    // content frontier.
    expect(loaded?.pendingBaseVersion).toBe(syncedMarker);

    const reloaded = await loadPersistedDocumentContent({
      execSql,
      localId: LOCAL_ID,
      persistence: sqlDocumentsPersistence,
    });
    if (!reloaded) {
      throw new Error("Expected restored document content");
    }
    const restoredMarker = loaded?.pendingBaseVersion ?? null;
    expect(restoredMarker).not.toBeNull();

    // The next local edit exports its delta since the restored (behind) marker,
    // folding the deferred isSelf op back into the outgoing stream.
    reloaded.getText("text").update("hello");
    reloaded.commit();
    const outgoing = exportUpdatesSince(reloaded, restoredMarker);

    importUpdates(peer, [outgoing]);
    expect(peer.getMap("meta").get("isSelf")).toBe(true);
    expect(peer.getText("text").toString()).toBe("hello");
  } finally {
    close();
  }
});

// A save that does not manage the marker (e.g. a discovery upsert or the
// registration bootstrap) must not clobber a marker a prior deferred write
// persisted on the row.
test("saving without a marker preserves the persisted pendingBaseVersion", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-base-version-preserve",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);

    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: LOCAL_ID,
      containerId: null,
      documentId: null,
      text: "first",
      snapshotEndVersion: "version-1",
      accessEpoch: 1,
      pendingBaseVersion: "marker-1",
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: LOCAL_ID,
      containerId: null,
      documentId: null,
      text: "second",
      snapshotEndVersion: "version-2",
      accessEpoch: 1,
    });

    const loaded = await sqlDocumentsPersistence.loadDocument(
      execSql,
      LOCAL_ID,
    );
    expect(loaded?.pendingBaseVersion).toBe("marker-1");
    expect(loaded?.text).toBe("second");
  } finally {
    close();
  }
});
