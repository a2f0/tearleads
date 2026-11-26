import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentRecordRepository } from "./documentRecordRepository";
import { ensureDocumentTables, MAX_PENDING_UPDATE_REKEYS } from "./index";

const documentScope = {
  appKind: "documents",
  localId: "local-document-1",
};

test("settling an outbox update removes it from the update log", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-persistence-test",
  );

  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);

    await records.enqueueDocumentPendingUpdate(documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    const pendingUpdates =
      await records.listDocumentPendingUpdates(documentScope);
    const pendingUpdate = pendingUpdates[0];

    expect(pendingUpdates).toHaveLength(1);
    expect(typeof pendingUpdate?.id).toBe("string");
    expect(pendingUpdate?.id.length).toBeGreaterThan(0);
    expect(pendingUpdate).toMatchObject({
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    await records.settleDocumentPendingUpdate(pendingUpdate?.id ?? "");

    await expect(
      records.listDocumentPendingUpdates(documentScope),
    ).resolves.toEqual([]);
    await expect(
      execSql("SELECT id FROM document_history_updates"),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("document pending update re-key swaps the id and keeps the fields", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-rekey-test",
  );

  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);

    await records.enqueueDocumentPendingUpdate(documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });
    const [pendingUpdate] =
      await records.listDocumentPendingUpdates(documentScope);
    if (!pendingUpdate) {
      throw new Error("Expected an enqueued pending update");
    }

    const nextId = await records.rekeyDocumentPendingUpdate(pendingUpdate.id);

    expect(nextId).not.toBe(pendingUpdate.id);
    const rekeyed = await records.listDocumentPendingUpdates(documentScope);
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]).toMatchObject({
      id: nextId,
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    await expect(
      records.rekeyDocumentPendingUpdate("missing-id"),
    ).resolves.toBeNull();
    await expect(
      records.listDocumentPendingUpdates(documentScope),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});

test("document pending update re-key stops at the persisted bound", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-rekey-bound-test",
  );

  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);

    await records.enqueueDocumentPendingUpdate(documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    let [pendingUpdate] =
      await records.listDocumentPendingUpdates(documentScope);
    expect(pendingUpdate?.rekeyCount).toBe(0);

    for (let attempt = 0; attempt < MAX_PENDING_UPDATE_REKEYS; attempt += 1) {
      const nextId = await records.rekeyDocumentPendingUpdate(
        pendingUpdate?.id ?? "",
      );
      expect(nextId).not.toBeNull();
      [pendingUpdate] = await records.listDocumentPendingUpdates(documentScope);
      expect(pendingUpdate?.rekeyCount).toBe(attempt + 1);
    }

    // The bound survives in the row itself: the next re-key refuses and
    // leaves the record untouched instead of minting a fresh id forever.
    await expect(
      records.rekeyDocumentPendingUpdate(pendingUpdate?.id ?? ""),
    ).resolves.toBeNull();
    const [unchanged] = await records.listDocumentPendingUpdates(documentScope);
    expect(unchanged).toMatchObject({
      id: pendingUpdate?.id ?? "",
      rekeyCount: MAX_PENDING_UPDATE_REKEYS,
    });
  } finally {
    close();
  }
});

test("document pending update cleanup is scoped by app kind and local id", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-cleanup-test",
  );

  const otherAppScope = {
    appKind: "other-app",
    localId: documentScope.localId,
  };
  const otherLocalScope = {
    appKind: documentScope.appKind,
    localId: "local-document-2",
  };

  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);

    for (const [scope, updateData] of [
      [documentScope, "scoped-update"],
      [otherAppScope, "other-app-update"],
      [otherLocalScope, "other-local-update"],
    ] as const) {
      await records.enqueueDocumentPendingUpdate(scope, {
        updateData,
        partialStartVersionVector: `${updateData}-start`,
        partialEndVersionVector: `${updateData}-end`,
      });
    }

    await records.unqueueDocumentPendingUpdates(documentScope);

    await expect(
      records.listDocumentPendingUpdates(documentScope),
    ).resolves.toEqual([]);
    await expect(
      records.listDocumentPendingUpdates(otherAppScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-app-update",
        partialEndVersionVector: "other-app-update-end",
      },
    ]);
    await expect(
      records.listDocumentPendingUpdates(otherLocalScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-local-update",
        partialEndVersionVector: "other-local-update-end",
      },
    ]);
  } finally {
    close();
  }
});

test("document pending update listing preserves insertion order for equal timestamps", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-order-test",
  );

  try {
    await ensureDocumentTables(execSql);

    for (const updateData of ["update-1", "update-2", "update-3"]) {
      await execSql(
        `INSERT INTO document_history_updates (
          id,
          app_kind,
          local_id,
          update_data,
          origin,
          created_at,
          update_id,
          partial_start_version_vector,
          partial_end_version_vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${updateData}-row`,
          documentScope.appKind,
          documentScope.localId,
          updateData,
          "local",
          "2026-05-08T00:00:00.000Z",
          `${updateData}-id`,
          `${updateData}-start`,
          `${updateData}-end`,
        ],
      );
    }

    await expect(
      new DocumentRecordRepository(execSql).listDocumentPendingUpdates(
        documentScope,
      ),
    ).resolves.toMatchObject([
      { updateData: "update-1" },
      { updateData: "update-2" },
      { updateData: "update-3" },
    ]);
  } finally {
    close();
  }
});

test("a queued local update is one tail row that compaction spares until settled", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-tail-row-test",
  );

  try {
    await ensureDocumentTables(execSql);
    const records = new DocumentRecordRepository(execSql);
    const updateId = await records.enqueueDocumentPendingUpdateWithHistory(
      documentScope,
      {
        updateData: "local-edit",
        partialStartVersionVector: "start",
        partialEndVersionVector: "end",
      },
    );
    const rows = await execSql(
      "SELECT id, origin, update_id FROM document_history_updates",
    );
    expect(rows).toEqual([
      { id: expect.any(String), origin: "local", update_id: updateId },
    ]);
    const rowId = String(Reflect.get(rows[0] ?? {}, "id"));
    await expect(
      records.loadDocumentHistoryRestoreState(documentScope),
    ).resolves.toMatchObject({
      tailUpdates: [{ origin: "local", updateData: "local-edit" }],
    });

    // A checkpoint may cover the queued operation, but the row is still the
    // unsent update: neither the candidate scan nor a named delete removes it.
    await expect(
      records.listDocumentHistoryTailEntries(documentScope),
    ).resolves.toEqual([]);
    await records.replaceDocumentHistoryCheckpoint(documentScope, {
      coveredTailIds: [rowId],
      endVersionVector: "end",
      force: true,
      snapshot: "",
    });
    await expect(
      records.listDocumentPendingUpdates(documentScope),
    ).resolves.toMatchObject([{ id: updateId, updateData: "local-edit" }]);

    // Settlement keeps the row as history, now compactable.
    await records.settleDocumentPendingUpdate(updateId ?? "");
    await expect(
      records.listDocumentPendingUpdates(documentScope),
    ).resolves.toEqual([]);
    await expect(
      records.listDocumentHistoryTailEntries(documentScope),
    ).resolves.toEqual([{ id: rowId, updateData: "local-edit" }]);
  } finally {
    close();
  }
});
