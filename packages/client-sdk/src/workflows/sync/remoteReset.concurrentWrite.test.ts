import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  clientSqlTables,
  containers,
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentPendingUpdates,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { clearRemoteSyncState } from "./remoteReset";

const STALE = "2026-08-01T00:00:00.000Z";

test("a write racing reset remains queued after the atomic reset snapshot", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-concurrent-write-test",
  );
  let pausePlanRead = false;
  let planReadPaused!: () => void;
  const planReadStarted = new Promise<void>((resolve) => {
    planReadPaused = resolve;
  });
  let releasePlanRead!: () => void;
  const planReadHold = new Promise<void>((resolve) => {
    releasePlanRead = resolve;
  });
  let didPause = false;
  const serializedExecSql = (async (sql, bind, options) => {
    const rows = await execSql(sql, bind, options);
    if (
      pausePlanRead &&
      !didPause &&
      sql.includes('from "document_history_updates"')
    ) {
      didPause = true;
      planReadPaused();
      await planReadHold;
    }
    return rows;
  }) as ExecSql;

  try {
    await ensureSqlTables(serializedExecSql, clientSqlTables);
    const runtime = getClientSQLitePersistenceRuntime(serializedExecSql);
    const doc = await createDocument("remote-reset-concurrent-write");
    doc.getText("text").update("before reset");
    const version = encodeVersionVector(doc);
    await runtime.transaction(async (tx) => {
      await tx.insert(containers).values({
        id: "concurrent-root",
        organizationId: "org-old",
        parentId: null,
        metadataDocumentId: null,
        systemSlot: "root",
        localCreatedAt: STALE,
        localUpdatedAt: STALE,
      });
      await tx.insert(documents).values({
        appKind: "documents",
        localId: "concurrent-note",
        documentId: "old-remote-document",
        snapshotEndVersion: version,
        updatedAt: STALE,
      });
      await tx.insert(documentHistoryCheckpoints).values({
        appKind: "documents",
        localId: "concurrent-note",
        snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
        endVersionVector: version,
        revision: crypto.randomUUID(),
        updatedAt: STALE,
      });
      await tx.insert(documentProjection).values({
        localId: "concurrent-note",
        documentId: "old-remote-document",
        containerId: "concurrent-root",
        organizationId: "org-old",
        documentKind: "note",
        title: "Concurrent note",
        updatedAt: STALE,
      });
    });
    doc.getText("text").update("during reset");
    doc.commit();
    const concurrentPending = createPendingUpdateFields(
      exportUpdatesSince(doc, version),
    );
    if (!concurrentPending) {
      throw new Error("Expected a concurrent pending update");
    }

    pausePlanRead = true;
    const reset = clearRemoteSyncState(serializedExecSql, {
      organizationId: "org-old",
    });
    await planReadStarted;
    const concurrentWrite = sqlDocumentsPersistence.enqueuePendingUpdate(
      serializedExecSql,
      { localId: "concurrent-note", ...concurrentPending },
    );
    releasePlanRead();
    const [, queued] = await Promise.all([reset, concurrentWrite]);
    expect(queued).toBe(true);

    const pendingRows = await runtime.db
      .select({ updateData: documentPendingUpdates.updateData })
      .from(documentPendingUpdates);
    expect(pendingRows).toContainEqual({
      updateData: concurrentPending.updateData,
    });
    const historyRows = await runtime.db
      .select({ updateData: documentHistoryUpdates.updateData })
      .from(documentHistoryUpdates);
    expect(historyRows).toContainEqual({
      updateData: concurrentPending.updateData,
    });
  } finally {
    releasePlanRead();
    close();
  }
});
