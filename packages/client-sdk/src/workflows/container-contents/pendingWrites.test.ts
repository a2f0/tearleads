import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  ensurePendingWriteSchema,
  insertTestPendingUpdate,
  saveTestSyncedContainer,
} from "./documentQueries.testFixtures";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";
const T3 = "2026-01-01T00:00:03.000Z";
const T4 = "2026-01-01T00:00:04.000Z";

async function saveRemoteContainer(input: {
  containerId: string;
  execSql: ExecSql;
  name?: string;
  organizationId?: string;
  parentId?: string | null;
  updatedAt?: string;
}): Promise<void> {
  await saveTestSyncedContainer({
    execSql: input.execSql,
    id: input.containerId,
    name: input.name ?? input.containerId,
    organizationId: input.organizationId ?? "organization-a",
    parentId: input.parentId ?? null,
    timestamp: input.updatedAt ?? T0,
  });
}

async function saveLocalContainer(input: {
  containerId: string;
  execSql: ExecSql;
  name?: string;
  parentId?: string | null;
  updatedAt?: string;
}): Promise<void> {
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.containerId,
      metadataDocumentId: null,
      name: input.name ?? input.containerId,
      organizationId: "organization-a",
      parentId: input.parentId ?? "root",
    },
    null,
    { localUpdatedAt: input.updatedAt ?? T0 },
  );
}

async function saveDocument(input: {
  containerId: string;
  documentId?: string | null;
  execSql: ExecSql;
  localId: string;
  pendingBaseVersion?: string | null;
  snapshotEndVersion?: string;
  title?: string;
  updatedAt?: string;
}): Promise<void> {
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: input.containerId,
      documentId: input.documentId ?? null,
      documentKind: "note",
      id: input.localId,
      ...(input.pendingBaseVersion === undefined
        ? {}
        : { pendingBaseVersion: input.pendingBaseVersion }),
      snapshotEndVersion: input.snapshotEndVersion ?? "",
      text: "",
      title: input.title ?? input.localId,
    },
    { updatedAt: input.updatedAt ?? T0 },
  );
}

async function insertPendingUpdate(input: {
  appKind: string;
  createdAt: string;
  execSql: ExecSql;
  id: string;
  localId: string;
  partialEndVersionVector?: string;
}): Promise<void> {
  await insertTestPendingUpdate({
    appKind: input.appKind,
    createdAt: input.createdAt,
    execSql: input.execSql,
    id: input.id,
    localId: input.localId,
    partialEndVersionVector: input.partialEndVersionVector,
    updateData: `secret-update-${input.id}`,
  });
}

test("listPendingWrites groups every durable source without exposing payloads", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-all-sources",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveRemoteContainer({
      containerId: "root",
      execSql,
      name: "/",
    });
    await saveRemoteContainer({
      containerId: "documents-container",
      execSql,
      name: "Documents",
      parentId: "root",
    });
    await saveRemoteContainer({
      containerId: "metadata-container",
      execSql,
      name: "Metadata",
      parentId: "root",
    });
    await saveRemoteContainer({
      containerId: "moved-container",
      execSql,
      name: "Moved",
      parentId: "root",
    });
    await saveLocalContainer({
      containerId: "created-container",
      execSql,
      name: "Created",
      parentId: "root",
      updatedAt: T4,
    });
    await saveDocument({
      containerId: "documents-container",
      documentId: "remote-document",
      execSql,
      localId: "local-document",
      title: "Pending document",
    });

    await insertPendingUpdate({
      appKind: "documents",
      createdAt: T1,
      execSql,
      id: "document-update",
      localId: "local-document",
    });
    await insertPendingUpdate({
      appKind: "container-metadata",
      createdAt: T0,
      execSql,
      id: "metadata-update",
      localId: "metadata-container",
    });
    await insertPendingUpdate({
      appKind: "custom-namespace",
      createdAt: T0,
      execSql,
      id: "unknown-update",
      localId: "unknown-local-id",
    });
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, mime_type, storage_key, byte_length,
        created_at, upload_blob_id, upload_content_key, upload_iv,
        upload_content_key_epoch, upload_part_size, upload_stage_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "local-document",
        "attachment-slot",
        "pending.txt",
        "text/plain",
        "secret-storage-key",
        42,
        T2,
        "secret-blob-id",
        "secret-content-key",
        "secret-iv",
        1,
        1024,
        "secret-stage-id",
      ],
    );
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        remote_container_id, remote_metadata_document_id,
        remote_metadata_access_state_hash, last_error, last_attempted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'container.create', 'pending', NULL, NULL, NULL, ?, ?, ?, ?)`,
      [
        "create-intent",
        "created-container",
        "root",
        "create retry failed",
        T4,
        T3,
        T4,
      ],
    );
    await execSql(
      `INSERT INTO container_move_intents (
        id, container_id, parent_container_id, previous_parent_container_id,
        intent_type, sync_status, last_error, last_attempted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'container.move', 'blocked', ?, ?, ?, ?)`,
      [
        "container-move",
        "moved-container",
        "metadata-container",
        "root",
        "destination is not ready",
        T3,
        T2,
        T3,
      ],
    );
    await execSql(
      `INSERT INTO document_move_intents (
        id, local_id, document_id, target_container_id, source_container_id,
        replace_linked_containers, intent_type, sync_status, last_error,
        last_attempted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'document.move', 'blocked', ?, ?, ?, ?)`,
      [
        "document-move",
        "local-document",
        "remote-document",
        "metadata-container",
        "documents-container",
        "document destination is not ready",
        T4,
        T3,
        T4,
      ],
    );

    const items = await listPendingWrites(execSql);
    const document = items.find((item) => item.localId === "local-document");
    expect(document).toMatchObject({
      containerId: "documents-container",
      name: "Pending document",
      objectKind: "document",
      organizationId: "organization-a",
      remoteId: "remote-document",
      status: "blocked",
    });
    expect(document?.operations).toEqual([
      {
        byteLength: 0,
        count: 1,
        createdAt: T3,
        kind: "move",
        lastAttemptedAt: T4,
        lastError: "document destination is not ready",
        status: "blocked",
        targetContainerId: "metadata-container",
        updatedAt: T4,
      },
      expect.objectContaining({ count: 1, kind: "update" }),
      expect.objectContaining({
        byteLength: 42,
        count: 1,
        kind: "attachment",
      }),
    ]);

    expect(
      items.find((item) => item.localId === "created-container"),
    ).toMatchObject({
      objectKind: "container",
      operations: [
        expect.objectContaining({
          kind: "create",
          lastAttemptedAt: T4,
          lastError: "create retry failed",
          targetContainerId: "root",
        }),
      ],
      status: "error",
    });
    expect(
      items.find((item) => item.localId === "moved-container"),
    ).toMatchObject({
      operations: [
        expect.objectContaining({ kind: "move", status: "blocked" }),
      ],
      status: "blocked",
    });
    expect(
      items.find((item) => item.localId === "metadata-container"),
    ).toMatchObject({
      name: "Metadata",
      operations: [expect.objectContaining({ kind: "update" })],
      organizationId: "organization-a",
    });
    expect(
      items.find((item) => item.localId === "unknown-local-id"),
    ).toMatchObject({
      namespace: "custom-namespace",
      objectKind: "unknown",
      operations: [expect.objectContaining({ kind: "update" })],
    });

    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("secret-update");
    expect(serialized).not.toContain("secret-storage-key");
    expect(serialized).not.toContain("secret-content-key");
    expect(serialized).not.toContain("secret-stage-id");
  } finally {
    close();
  }
});

test("listPendingWrites includes inferred local-only blank objects", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-local-only",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveRemoteContainer({ containerId: "root", execSql });
    await saveLocalContainer({
      containerId: "local-system-container",
      execSql,
      name: "Local system",
      parentId: "root",
      updatedAt: T1,
    });
    await saveDocument({
      containerId: "local-system-container",
      execSql,
      localId: "blank-local-document",
      title: "Blank local document",
      updatedAt: T2,
    });

    const items = await listPendingWrites(execSql);
    expect(items.map((item) => item.localId)).toEqual([
      "local-system-container",
      "blank-local-document",
    ]);
    expect(items[0]).toMatchObject({
      operations: [expect.objectContaining({ kind: "create" })],
      remoteId: null,
    });
    expect(items[1]).toMatchObject({
      operations: [expect.objectContaining({ kind: "create" })],
      remoteId: null,
    });
  } finally {
    close();
  }
});

test("listPendingWrites distinguishes deferred Loro tails from queued coverage", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-deferred-tails",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveRemoteContainer({ containerId: "root", execSql });

    const doc = await createDocument("pending-write-tail");
    doc.getText("text").update("baseline");
    doc.commit();
    const pendingBaseVersion = encodeVersionVector(doc);
    doc.getText("text").update("deferred tail");
    doc.commit();
    const snapshotEndVersion = encodeVersionVector(doc);
    const coveredUpdate = createPendingUpdateFields(
      exportUpdatesSince(doc, pendingBaseVersion),
    );
    if (!coveredUpdate) throw new Error("Expected a covered update fixture");

    await saveDocument({
      containerId: "root",
      documentId: "remote-deferred",
      execSql,
      localId: "deferred-document",
      pendingBaseVersion,
      snapshotEndVersion,
      updatedAt: T1,
    });
    await saveDocument({
      containerId: "root",
      documentId: "remote-covered",
      execSql,
      localId: "covered-document",
      pendingBaseVersion,
      snapshotEndVersion,
      updatedAt: T2,
    });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "covered-document",
      ...coveredUpdate,
    });
    await saveDocument({
      containerId: "root",
      documentId: "remote-current-marker",
      execSql,
      localId: "current-marker-document",
      pendingBaseVersion: encodeVersionVector(doc),
      snapshotEndVersion,
      updatedAt: T3,
    });

    const items = await listPendingWrites(execSql);
    expect(
      items.find((item) => item.localId === "deferred-document")?.operations,
    ).toEqual([expect.objectContaining({ kind: "deferred-update" })]);
    expect(
      items.find((item) => item.localId === "covered-document")?.operations,
    ).toEqual([expect.objectContaining({ kind: "update" })]);
    expect(
      items.find((item) => item.localId === "current-marker-document"),
    ).toBeUndefined();
  } finally {
    close();
  }
});

test("listPendingWrites ordering is deterministic for timestamp ties", async () => {
  const { close, execSql } = await createTestExecSql(
    "pending-writes-deterministic-order",
  );
  try {
    await ensurePendingWriteSchema(execSql);
    await saveLocalContainer({
      containerId: "container-b",
      execSql,
      updatedAt: T1,
    });
    await saveLocalContainer({
      containerId: "container-a",
      execSql,
      updatedAt: T1,
    });
    await saveDocument({
      containerId: "container-a",
      execSql,
      localId: "document-a",
      updatedAt: T1,
    });

    const first = await listPendingWrites(execSql);
    const second = await listPendingWrites(execSql);
    const identity = (item: (typeof first)[number]) =>
      `${item.objectKind}:${item.namespace ?? ""}:${item.localId}`;
    expect(first.map(identity)).toEqual([
      "container::container-a",
      "container::container-b",
      "document::document-a",
    ]);
    expect(second.map(identity)).toEqual(first.map(identity));
  } finally {
    close();
  }
});
