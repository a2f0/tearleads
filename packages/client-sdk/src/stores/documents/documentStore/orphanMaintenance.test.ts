import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";
import { runDocumentOrphanMaintenance } from "./orphanMaintenance";
import type { DocumentStoreState } from "./state";

function createMaintenanceRuntime(
  execSql: DocumentsWorkflowRuntimeInput["infra"]["execSql"],
  blobStore: BlobStore,
) {
  return createDocumentsWorkflowRuntime({
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: {
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
      blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: false,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for document startup")),
          3_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test("document startup does not wait for orphan byte maintenance", async () => {
  const { close, execSql } = await createTestExecSql(
    "detached-orphan-maintenance",
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
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO document_pending_attachments (
        local_id, slot_id, name, storage_key, byte_length, created_at
      ) VALUES ('orphan', 'slot', 'orphan.txt', 'orphan-storage', 1, ?)`,
      ["2000-01-01T00:00:00.000Z"],
    );
    const blobStore = {
      deleteBytes: async () => {
        markDeleteStarted();
        await deleteBlocked;
      },
      openByteSource: async () => null,
      readBytes: async () => null,
      writeByteSource: async () => undefined,
      writeBytes: async () => undefined,
    } satisfies BlobStore;
    const runtime = createMaintenanceRuntime(execSql, blobStore);
    const store = createDocumentStore(
      "startup-document",
      runtime,
      defaultDocumentsPersistence,
    );

    const initialization = store.ensureInitialized();
    await settleWithin(deleteStarted);
    expect(await settleWithin(initialization)).toBe(true);
    releaseDelete();
    await reclaimDocumentOrphanBlobs(runtime);
  } finally {
    releaseDelete();
    close();
  }
});

test("aged orphan sweep runs only once per connection", async () => {
  const { close, execSql } = await createTestExecSql("once-orphan-maintenance");
  const blobStore = {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  } satisfies BlobStore;
  const runtime = createMaintenanceRuntime(execSql, blobStore);
  const insertOrphan = (id: string) =>
    execSql(
      `INSERT INTO document_history_updates (
        id, app_kind, local_id, update_data, origin, created_at
      ) VALUES (?, 'documents', ?, 'update', 'local', ?)`,
      [id, id, "2000-01-01T00:00:00.000Z"],
    );
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await insertOrphan("first-orphan");
    await reclaimDocumentOrphanBlobs(runtime);
    expect(
      await execSql("SELECT id FROM document_history_updates ORDER BY id"),
    ).toEqual([]);

    await insertOrphan("second-orphan");
    await reclaimDocumentOrphanBlobs(runtime);
    expect(
      await execSql("SELECT id FROM document_history_updates ORDER BY id"),
    ).toEqual([{ id: "second-orphan" }]);
  } finally {
    close();
  }
});

test("custom document persistence skips SQL orphan maintenance", async () => {
  let sqlCalls = 0;
  const state = {
    persistence: { ...defaultDocumentsPersistence },
    runtime: {
      infra: {
        dbStatus: "ready",
        execSql: async () => {
          sqlCalls += 1;
          return [];
        },
      },
    },
  } as unknown as DocumentStoreState;

  await runDocumentOrphanMaintenance(state);

  expect(sqlCalls).toBe(0);
});
