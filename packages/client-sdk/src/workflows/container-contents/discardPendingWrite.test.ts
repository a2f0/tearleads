import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { recordDocumentSyncFailure } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { discardPendingWrite } from "./discardPendingWrite";
import { listPendingWrites } from "./pendingWrites";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

async function insertPendingUpdate(input: {
  appKind: string;
  execSql: ExecSql;
  id: string;
  localId: string;
}): Promise<void> {
  await input.execSql(
    `INSERT INTO document_pending_updates (
      id, app_kind, local_id, update_data,
      partial_start_version_vector, partial_end_version_vector,
      source_version_vector, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [input.id, input.appKind, input.localId, "payload", "{}", "{}", T1],
  );
}

test("discarding a document write tears down its whole local sync state", async () => {
  const { close, execSql } = await createTestExecSql(
    "discard-pending-write-document",
  );
  try {
    await listPendingWrites(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: null,
        containerId: null,
        documentId: "remote-document",
        documentKind: "note",
        id: "local-document",
        loroSnapshot: "",
        text: "",
        title: "Stuck note",
      },
      { updatedAt: T0 },
    );
    await insertPendingUpdate({
      appKind: "documents",
      execSql,
      id: "stuck-update",
      localId: "local-document",
    });
    await recordDocumentSyncFailure(
      execSql,
      { appKind: "documents", localId: "local-document" },
      {
        attemptedAt: T1,
        message: "Write access denied by the server (403)",
        status: 403,
      },
    );
    await execSql(
      `INSERT INTO document_move_intents (
        id, local_id, document_id, target_container_id, source_container_id,
        replace_linked_containers, intent_type, sync_status, last_error,
        last_attempted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 0, 'document.move', 'pending', NULL, NULL, ?, ?)`,
      ["stuck-move", "local-document", "remote-document", "target", T0, T1],
    );
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "local-document",
      ),
    ).toBe(true);

    await discardPendingWrite({
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      localId: "local-document",
      namespace: null,
      objectKind: "document",
    });

    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "local-document",
      ),
    ).toBe(false);
    expect(
      await execSql("SELECT local_id FROM document_sync_failures"),
    ).toHaveLength(0);
    expect(await execSql("SELECT id FROM document_move_intents")).toHaveLength(
      0,
    );
  } finally {
    close();
  }
});

test("discarding a container write drops its intents and metadata queue rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "discard-pending-write-container",
  );
  try {
    await listPendingWrites(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        effectiveAccessLevel: "admin",
        icon: null,
        id: "stuck-container",
        metadataDocumentId: null,
        name: "Stuck",
        organizationId: "organization-a",
        parentId: "root",
      },
      null,
      { localUpdatedAt: T0 },
    );
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        remote_container_id, remote_metadata_document_id,
        remote_metadata_access_state_hash, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, 'container.create', 'pending', NULL, NULL, NULL, NULL, ?, ?)`,
      ["stuck-create", "stuck-container", "root", T0, T1],
    );
    await insertPendingUpdate({
      appKind: "container-metadata",
      execSql,
      id: "stuck-metadata",
      localId: "stuck-container",
    });
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "stuck-container",
      ),
    ).toBe(true);

    await discardPendingWrite({
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      localId: "stuck-container",
      namespace: null,
      objectKind: "container",
    });

    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "stuck-container",
      ),
    ).toBe(false);
    expect(
      await execSql("SELECT id FROM container_create_intents"),
    ).toHaveLength(0);
    expect(
      await execSql("SELECT id FROM document_pending_updates"),
    ).toHaveLength(0);
  } finally {
    close();
  }
});

test("discarding an unknown-namespace write drops its queue rows and record", async () => {
  const { close, execSql } = await createTestExecSql(
    "discard-pending-write-unknown",
  );
  try {
    await listPendingWrites(execSql);
    await insertPendingUpdate({
      appKind: "custom-namespace",
      execSql,
      id: "unknown-update",
      localId: "unknown-local",
    });
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "unknown-local",
      ),
    ).toBe(true);

    await discardPendingWrite({
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      localId: "unknown-local",
      namespace: "custom-namespace",
      objectKind: "unknown",
    });

    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "unknown-local",
      ),
    ).toBe(false);
  } finally {
    close();
  }
});
