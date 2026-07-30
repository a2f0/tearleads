import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobBytes, BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  resetConnectionSchemaMemo,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { reclaimDocumentOrphanBlobs } from "./orphanBlobReclaims";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const OLD = "2026-07-01T00:00:00.000Z";

function createRuntime(input: {
  blobStore: BlobStore;
  execSql: DocumentsWorkflowRuntimeGroups["infra"]["execSql"];
  logs: string[];
}): DocumentsWorkflowRuntimeGroups {
  return {
    auth: {
      defaultOrganizationId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: input.blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: false,
    },
    util: { log: (message) => input.logs.push(message) },
  };
}

test("orphan attachment bytes stay queued until local deletion succeeds", async () => {
  const { close, execSql } = await createTestExecSql("orphan-blob-reclaims");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, storage_key, byte_length, created_at
      ) VALUES ('orphan', 'slot', 'orphan.txt', 'orphan-storage', 1, ?)`,
      [OLD],
    );

    const deletedStorageKeys: string[] = [];
    const logs: string[] = [];
    let failDeletes = true;
    const blobStore = {
      deleteBytes: async (storageKey: string) => {
        if (failDeletes) {
          throw new Error("busy");
        }
        deletedStorageKeys.push(storageKey);
      },
      openByteSource: async () => null,
      readBytes: async () => null,
      writeByteSource: async () => undefined,
      writeBytes: async () => undefined,
    } satisfies BlobStore;
    const runtime = createRuntime({ blobStore, execSql, logs });

    await reclaimDocumentOrphanBlobs(runtime);
    expect(
      await execSql("SELECT storage_key FROM document_orphan_blob_reclaims"),
    ).toEqual([{ storage_key: "orphan-storage" }]);
    expect(logs).toEqual([
      "Documents: orphan maintenance deferred 1 blob(s): orphan-storage",
    ]);

    failDeletes = false;
    await reclaimDocumentOrphanBlobs(runtime);
    expect(deletedStorageKeys).toEqual([]);
    expect(logs).toHaveLength(1);

    // A failed byte deletion stays durable without re-running on every store
    // open. A fresh connection (modeled by resetting its once-key memo) retries.
    resetConnectionSchemaMemo(execSql);
    await reclaimDocumentOrphanBlobs(runtime);
    expect(deletedStorageKeys).toEqual(["orphan-storage"]);
    expect(
      await execSql("SELECT storage_key FROM document_orphan_blob_reclaims"),
    ).toEqual([]);
    expect(
      await execSql("SELECT local_id FROM document_pending_attachments"),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a queued key still referenced by a live row is acknowledged but not deleted", async () => {
  const { close, execSql } = await createTestExecSql(
    "referenced-orphan-blob-reclaim",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, updated_at)
       VALUES ('documents', 'live', ?)`,
      [OLD],
    );
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, storage_key, byte_length, created_at
      ) VALUES ('live', 'slot', 'live.txt', 'shared-storage', 1, ?)`,
      [OLD],
    );
    await execSql(
      `INSERT INTO document_orphan_blob_reclaims (storage_key)
       VALUES ('shared-storage')`,
    );
    const deletedStorageKeys: string[] = [];
    const runtime = createRuntime({
      blobStore: {
        deleteBytes: async (storageKey) => {
          deletedStorageKeys.push(storageKey);
        },
        openByteSource: async () => null,
        readBytes: async () => null,
        writeByteSource: async () => undefined,
        writeBytes: async () => undefined,
      },
      execSql,
      logs: [],
    });

    await reclaimDocumentOrphanBlobs(runtime);

    expect(deletedStorageKeys).toEqual([]);
    expect(
      await execSql("SELECT storage_key FROM document_orphan_blob_reclaims"),
    ).toEqual([]);
    expect(
      await execSql("SELECT storage_key FROM document_pending_attachments"),
    ).toEqual([{ storage_key: "shared-storage" }]);
  } finally {
    close();
  }
});

test("reclaim and hydration serialize byte deletion before the live row write", async () => {
  const { close, execSql } = await createTestExecSql(
    "serialized-orphan-blob-reclaim",
  );
  let releaseDelete: () => void = () => undefined;
  const deleteBlocked = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let markDeleteStarted: () => void = () => undefined;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO document_orphan_blob_reclaims (storage_key)
       VALUES ('shared-storage')`,
    );
    let storedBytes: BlobBytes | null = new Uint8Array([0]);
    const blobStore = {
      deleteBytes: async () => {
        markDeleteStarted();
        await deleteBlocked;
        storedBytes = null;
      },
      openByteSource: async () => null,
      readBytes: async () => storedBytes,
      writeByteSource: async () => undefined,
      writeBytes: async (_storageKey, bytes) => {
        storedBytes = bytes;
      },
    } satisfies BlobStore;
    const reclaim = reclaimDocumentOrphanBlobs(
      createRuntime({ blobStore, execSql, logs: [] }),
    );
    await deleteStarted;

    let hydrationStarted = false;
    const hydration = runSerializedSqlMutation(
      execSql,
      async (lockedExecSql) => {
        hydrationStarted = true;
        await blobStore.writeBytes("shared-storage", new Uint8Array([1]));
        await sqlDocumentsPersistence.saveLocalAttachment(lockedExecSql, {
          blobId: "blob-id",
          byteLength: 1,
          detachedAt: null,
          localId: "live",
          mimeType: "application/octet-stream",
          slotId: "slot",
          storageKey: "shared-storage",
        });
      },
    );
    await Promise.resolve();
    expect(hydrationStarted).toBe(false);

    releaseDelete();
    await Promise.all([reclaim, hydration]);
    expect(storedBytes).toEqual(new Uint8Array([1]));
    expect(
      await execSql(
        "SELECT storage_key FROM document_attachment_blob_projection",
      ),
    ).toEqual([{ storage_key: "shared-storage" }]);
  } finally {
    releaseDelete();
    close();
  }
});
