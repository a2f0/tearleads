import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  clearDocumentSyncFailure,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  listPendingWrites,
  resetPendingWriteRetryState,
} from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

const DOCUMENT_SCOPE = { appKind: "documents", localId: "local-document" };

async function ensurePendingWriteSchema(execSql: ExecSql): Promise<void> {
  await listPendingWrites(execSql);
}

async function saveSharedOrgContainerWithPendingDocument(
  execSql: ExecSql,
): Promise<void> {
  const metadataDocumentId = "metadata-shared-container";
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: "shared-container",
      metadataDocumentId,
      name: "Shared",
      organizationId: "peer-organization",
      parentId: null,
    },
    {
      accessEpoch: 1,
      accessStateHash: "access-shared-container",
      documentId: metadataDocumentId,
      id: "shared-container",
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
    {
      localUpdatedAt: T0,
      serverTimestamps: { createdAt: T0, updatedAt: T0 },
    },
  );
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: "shared-container",
      documentId: "remote-document",
      documentKind: "note",
      id: "local-document",
      snapshotEndVersion: "",
      text: "",
      title: "Shared note",
    },
    { updatedAt: T0 },
  );
  await execSql(
    `INSERT INTO document_pending_updates (
      id, app_kind, local_id, update_data,
      partial_start_version_vector, partial_end_version_vector,
      source_version_vector, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    ["denied-update", "documents", "local-document", "payload", "{}", "{}", T1],
  );
}

test("a recorded terminal failure surfaces as an errored queue item", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-sync-failure",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveSharedOrgContainerWithPendingDocument(execSql);

    await recordDocumentSyncFailure(execSql, DOCUMENT_SCOPE, {
      attemptedAt: T2,
      message: "Write access denied by the server (403)",
      status: 403,
    });

    const items = await listPendingWrites(execSql);
    const document = items.find((item) => item.localId === "local-document");
    expect(document).toMatchObject({
      organizationId: "peer-organization",
      status: "error",
    });
    expect(document?.operations).toEqual([
      expect.objectContaining({
        kind: "update",
        lastAttemptedAt: T2,
        lastError: "Write access denied by the server (403)",
      }),
    ]);

    await clearDocumentSyncFailure(execSql, DOCUMENT_SCOPE);
    const cleared = await listPendingWrites(execSql);
    expect(
      cleared.find((item) => item.localId === "local-document"),
    ).toMatchObject({ status: "pending" });
  } finally {
    close();
  }
});

// Edge-case row 13: a refused read-only revalidation records a durable
// failure row with NO pending work. The queue must still surface it — and
// must not duplicate the item once real pending work exists (the pending
// candidates carry the same failure through their own joins).
test("a failure with no pending work surfaces as its own queue item", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-failure-only",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: null,
        containerId: null,
        documentId: "remote-document",
        documentKind: "note",
        id: "local-document",
        snapshotEndVersion: "",
        text: "",
        title: "Stale note",
      },
      { updatedAt: T0 },
    );

    await recordDocumentSyncFailure(execSql, DOCUMENT_SCOPE, {
      attemptedAt: T2,
      message: "Remote revalidation failed: container unavailable (409)",
      status: 409,
    });

    const items = await listPendingWrites(execSql);
    const failureItems = items.filter(
      (item) => item.localId === "local-document",
    );
    expect(failureItems).toHaveLength(1);
    expect(failureItems[0]).toMatchObject({ status: "error" });
    expect(failureItems[0]?.operations).toEqual([
      expect.objectContaining({
        kind: "revalidation",
        lastAttemptedAt: T2,
        lastError: "Remote revalidation failed: container unavailable (409)",
      }),
    ]);

    // Real pending work absorbs the failure instead of duplicating the item.
    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector,
        source_version_vector, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      ["queued-edit", "documents", "local-document", "payload", "{}", "{}", T1],
    );
    const withPending = await listPendingWrites(execSql);
    const combined = withPending.filter(
      (item) => item.localId === "local-document",
    );
    expect(combined).toHaveLength(1);
    expect(combined[0]?.operations).toHaveLength(1);
    expect(combined[0]?.operations[0]).toMatchObject({
      count: 1,
      kind: "update",
      lastError: "Remote revalidation failed: container unavailable (409)",
    });

    // A later clean pass clears the row and the failure-only item with it.
    await clearDocumentSyncFailure(execSql, DOCUMENT_SCOPE);
    await execSql(`DELETE FROM document_pending_updates`);
    const cleared = await listPendingWrites(execSql);
    expect(
      cleared.find((item) => item.localId === "local-document"),
    ).toBeUndefined();
  } finally {
    close();
  }
});

test("queue items keep their org id after the shared container is removed", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-org-retention",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveSharedOrgContainerWithPendingDocument(execSql);

    // Access revocation tombstones the shared container locally; the pending
    // document update survives it. The org id must survive too instead of
    // rendering as "-" in the write queue.
    await defaultContainerContentsPersistence.deleteContainers(
      execSql,
      ["shared-container"],
      { updatedAt: T2 },
    );

    const items = await listPendingWrites(execSql);
    const document = items.find((item) => item.localId === "local-document");
    expect(document).toMatchObject({
      containerId: null,
      organizationId: "peer-organization",
    });
  } finally {
    close();
  }
});

// "Retry sync" on a failure-only item must not consume the failure row: with
// no queued work there is no lane to re-drive, so the row doubles as the
// priming ticket and clears on the next clean pass. With queued work the
// retry keeps its row-11 semantics and clears the row with the budget reset.
test("retry keeps a failure-only row and clears it with queued work", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-retry-keeps-row",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await recordDocumentSyncFailure(execSql, DOCUMENT_SCOPE, {
      attemptedAt: T2,
      message: "Remote revalidation failed: container unavailable (409)",
      status: 409,
    });

    await resetPendingWriteRetryState(execSql, {
      localId: "local-document",
      namespace: null,
      objectKind: "document",
    });
    const kept = await listPendingWrites(execSql);
    expect(
      kept.find((item) => item.localId === "local-document"),
    ).toMatchObject({ status: "error" });

    await execSql(
      `INSERT INTO document_pending_updates (
        id, app_kind, local_id, update_data,
        partial_start_version_vector, partial_end_version_vector,
        source_version_vector, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      ["retry-edit", "documents", "local-document", "payload", "{}", "{}", T1],
    );
    await resetPendingWriteRetryState(execSql, {
      localId: "local-document",
      namespace: null,
      objectKind: "document",
    });
    const cleared = await listPendingWrites(execSql);
    expect(
      cleared.find((item) => item.localId === "local-document"),
    ).toMatchObject({ status: "pending" });
  } finally {
    close();
  }
});
