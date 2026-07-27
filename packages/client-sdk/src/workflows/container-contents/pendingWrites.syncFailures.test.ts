import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  clearDocumentSyncFailure,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { listPendingWrites } from "./pendingWrites";

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
