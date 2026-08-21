import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  MAX_PENDING_UPDATE_REKEYS,
  rekeyDocumentPendingUpdate,
} from "./documentPersistence";

const documentScope = {
  appKind: "documents",
  localId: "local-document-1",
};

test("document pending updates persist queue fields and delete by id", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-pending-update-persistence-test",
  );

  try {
    await ensureDocumentTables(execSql);

    await enqueueDocumentPendingUpdate(execSql, documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    const pendingUpdates = await listDocumentPendingUpdates(
      execSql,
      documentScope,
    );
    const pendingUpdate = pendingUpdates[0];

    expect(pendingUpdates).toHaveLength(1);
    expect(typeof pendingUpdate?.id).toBe("string");
    expect(pendingUpdate?.id.length).toBeGreaterThan(0);
    expect(pendingUpdate).toMatchObject({
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
      sourceVersionVector: null,
    });

    await deleteDocumentPendingUpdate(execSql, pendingUpdate?.id ?? "");

    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
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

    await enqueueDocumentPendingUpdate(execSql, documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });
    const [pendingUpdate] = await listDocumentPendingUpdates(
      execSql,
      documentScope,
    );
    if (!pendingUpdate) {
      throw new Error("Expected an enqueued pending update");
    }

    const nextId = await rekeyDocumentPendingUpdate(execSql, pendingUpdate.id);

    expect(nextId).not.toBe(pendingUpdate.id);
    const rekeyed = await listDocumentPendingUpdates(execSql, documentScope);
    expect(rekeyed).toHaveLength(1);
    expect(rekeyed[0]).toMatchObject({
      id: nextId,
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    await expect(
      rekeyDocumentPendingUpdate(execSql, "missing-id"),
    ).resolves.toBeNull();
    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
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

    await enqueueDocumentPendingUpdate(execSql, documentScope, {
      updateData: "update-1",
      partialStartVersionVector: "start-vector-1",
      partialEndVersionVector: "end-vector-1",
    });

    let [pendingUpdate] = await listDocumentPendingUpdates(
      execSql,
      documentScope,
    );
    expect(pendingUpdate?.rekeyCount).toBe(0);

    for (let attempt = 0; attempt < MAX_PENDING_UPDATE_REKEYS; attempt += 1) {
      const nextId = await rekeyDocumentPendingUpdate(
        execSql,
        pendingUpdate?.id ?? "",
      );
      expect(nextId).not.toBeNull();
      [pendingUpdate] = await listDocumentPendingUpdates(
        execSql,
        documentScope,
      );
      expect(pendingUpdate?.rekeyCount).toBe(attempt + 1);
    }

    // The bound survives in the row itself: the next re-key refuses and
    // leaves the record untouched instead of minting a fresh id forever.
    await expect(
      rekeyDocumentPendingUpdate(execSql, pendingUpdate?.id ?? ""),
    ).resolves.toBeNull();
    const [unchanged] = await listDocumentPendingUpdates(
      execSql,
      documentScope,
    );
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

    for (const [scope, updateData] of [
      [documentScope, "scoped-update"],
      [otherAppScope, "other-app-update"],
      [otherLocalScope, "other-local-update"],
    ] as const) {
      await enqueueDocumentPendingUpdate(execSql, scope, {
        updateData,
        partialStartVersionVector: `${updateData}-start`,
        partialEndVersionVector: `${updateData}-end`,
        sourceVersionVector: `${updateData}-source`,
      });
    }

    await deleteDocumentPendingUpdates(execSql, documentScope);

    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
    ).resolves.toEqual([]);
    await expect(
      listDocumentPendingUpdates(execSql, otherAppScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-app-update",
        sourceVersionVector: "other-app-update-source",
      },
    ]);
    await expect(
      listDocumentPendingUpdates(execSql, otherLocalScope),
    ).resolves.toMatchObject([
      {
        updateData: "other-local-update",
        sourceVersionVector: "other-local-update-source",
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
        `INSERT INTO document_pending_updates (
          id,
          app_kind,
          local_id,
          update_data,
          partial_start_version_vector,
          partial_end_version_vector,
          source_version_vector,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${updateData}-id`,
          documentScope.appKind,
          documentScope.localId,
          updateData,
          `${updateData}-start`,
          `${updateData}-end`,
          null,
          "2026-05-08T00:00:00.000Z",
        ],
      );
    }

    await expect(
      listDocumentPendingUpdates(execSql, documentScope),
    ).resolves.toMatchObject([
      { updateData: "update-1" },
      { updateData: "update-2" },
      { updateData: "update-3" },
    ]);
  } finally {
    close();
  }
});
