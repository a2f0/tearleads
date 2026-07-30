import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { resetConnectionSchemaMemo } from "../../data/sqlite/sqlSchema";
import { reclaimDocumentOrphanBlobs } from "./orphanBlobReclaims";
import type { DocumentsWorkflowRuntimeGroups } from "./runtime";

const NOW = "2026-07-30T00:00:00.000Z";

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
      [NOW],
    );
    resetConnectionSchemaMemo(execSql);

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
      "Documents: could not reclaim orphan blob orphan-storage",
    ]);

    failDeletes = false;
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
