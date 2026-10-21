import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  insertQueuedUpdateRows,
  QUEUED_UPDATES_SQL,
} from "../../../../../test/helpers/queuedUpdateRows";
import { DocumentSyncUpdateIsolationError } from "../../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { clearDocumentSyncFailure } from "../../../../data/persistence/documents/records";
import { hasRecordedTerminalSyncFailures } from "../../../../data/persistence/documents/records/documentSyncFailurePersistence";
import { runSerializedSqlMutation } from "../../../../data/sqlite/sqlExec";
import type { DocumentRecord } from "../../../../workflows/documents/persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "../state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { deleteUpstreamDeletedDocument } from "./syncRequest";
import {
  documentIncomingUpdateIsolationFailureHandler,
  documentRevalidationFailureHandler,
  documentTerminalSubmitFailureHandler,
  ensureRemoteDocument,
} from "./syncShared";

// Failures live on the scope's `documents` row, so every recording scope
// starts from a stored document, as a running document store's does.
async function seedStoredDocument(
  execSql: Parameters<typeof sqlDocumentsPersistence.ensureSchema>[0],
  localId: string,
): Promise<void> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    containerId: null,
    documentId: null,
    id: localId,
    snapshotEndVersion: "",
    text: "",
  });
}

test("incoming poison updates record a durable document-scoped quarantine", async () => {
  const { close, execSql } = await createTestExecSql("incoming-quarantine");
  try {
    await seedStoredDocument(execSql, "quarantined-doc");
    const state = {
      localId: "quarantined-doc",
      runtime: { infra: { execSql }, util: {} },
    } as unknown as DocumentStoreState;
    const failure = new DocumentSyncUpdateIsolationError({
      cause: new Error("invalid Loro payload"),
      stage: "loro_import",
      updateId: "550e8400-e29b-41d4-a716-4466554400aa",
    });

    await documentIncomingUpdateIsolationFailureHandler(state)(failure);

    expect(
      await execSql(
        `SELECT sync_failure_status AS status, sync_failure_message AS message
         FROM documents
         WHERE app_kind = 'documents' AND local_id = 'quarantined-doc'`,
      ),
    ).toEqual([
      {
        message: failure.message,
        status: null,
      },
    ]);
  } finally {
    close();
  }
});

// Edge-case row 13's durable surface, with row 9's suppression intact: a
// refused read-only revalidation lands on the document's failure row, but a
// read-only 403 records nothing (it must never flag unattempted local edits).
test("revalidation failures record durably except read-only 403s", async () => {
  const { close, execSql } = await createTestExecSql("revalidation-record");
  try {
    await seedStoredDocument(execSql, "revalidating-doc");
    const state = {
      localId: "revalidating-doc",
      runtime: { infra: { execSql } },
    } as unknown as DocumentStoreState;
    const handler = documentRevalidationFailureHandler(state);

    await handler({ message: "denied", status: 403 });
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);

    await handler({
      message: "Container for this document is unavailable",
      status: 409,
    });
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
  } finally {
    close();
  }
});

// Row 3's local-only orphan: a null container scope can never create, and
// the lane must leave a durable failure row rather than going silent.
test("a container-less local-only create records a terminal failure", async () => {
  const { close, execSql } = await createTestExecSql("orphan-create-failure");
  try {
    await seedStoredDocument(execSql, "orphaned-local-only");
    const state = {
      localId: "orphaned-local-only",
      runtime: {
        infra: { execSql },
        state: { containerId: null },
        util: { log: () => undefined },
      },
    } as unknown as DocumentStoreState;
    const record = { documentId: null } as unknown as DocumentRecord;

    const result = await ensureRemoteDocument(
      state,
      {} as unknown as DocumentState,
      record,
      {} as unknown as EncapsulationKeyPair,
    );

    expect(result).toBe(record);
    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(true);
  } finally {
    close();
  }
});

// Row 3 → row 1 under a null container scope: an orphan's authoritative
// remote deletion must destroy local state exactly as it does for
// container-scoped stores — the deletion path never consults the container.
test("a null-scoped orphan destroys on authoritative deletion", async () => {
  const { close, execSql } = await createTestExecSql("orphan-remote-delete");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: null,
        containerId: "tombstoned-container",
        documentId: "remote-orphan",
        documentKind: "note",
        id: "orphan-doc",
        snapshotEndVersion: "",
        text: "queued edit",
        title: "queued edit",
      },
      { updatedAt: "2026-07-23T14:19:12.658Z" },
    );
    await insertQueuedUpdateRows(execSql, [
      {
        appKind: "documents",
        createdAt: "2026-07-23T14:19:13.000Z",
        id: "orphan-edit",
        localId: "orphan-doc",
        partialEndVersionVector: "{}",
        partialStartVersionVector: "{}",
        updateData: "payload",
      },
    ]);
    const record = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "orphan-doc",
    );
    if (!record) {
      throw new Error("expected seeded document record");
    }

    const doc = {} as unknown as DocumentState;
    const resolveProjectionUserKey = () => null;
    const state = {
      doc,
      listeners: new Set(),
      localId: "orphan-doc",
      localWriteGeneration: 0,
      locallyAcceptedUpdateIds: new Set(),
      persistence: sqlDocumentsPersistence,
      record,
      resolveProjectionUserKey,
      runtime: {
        infra: { documentProjectors: null, execSql },
        state: { containerId: null, domainScope: "scope" },
        util: { log: () => undefined },
      },
      snapshot: { attachments: [], attachmentStatusBySlotId: {} },
    } as unknown as DocumentStoreState;
    const generation = captureDocumentStoreSyncGeneration(state, doc);
    if (!generation) {
      throw new Error("expected a live document-store generation");
    }

    await deleteUpstreamDeletedDocument(
      state,
      generation,
      record,
      "remote-orphan",
    );

    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "orphan-doc"),
    ).toBeFalsy();
    const pendingRows = await execSql(
      `SELECT COUNT(*) AS n FROM ${QUEUED_UPDATES_SQL}
       WHERE app_kind = 'documents' AND local_id = ?`,
      ["orphan-doc"],
    );
    expect(Number(Reflect.get(pendingRows[0] ?? {}, "n") ?? -1)).toBe(0);
  } finally {
    close();
  }
});

// The teardown race: a terminal handler queued behind a teardown mutation
// must observe the invalidated generation INSIDE the serialized mutation and
// record nothing — never resurrect the failure row the teardown deleted.
test("a stale terminal handler cannot recreate a deleted failure row", async () => {
  const { close, execSql } = await createTestExecSql("stale-terminal-handler");
  try {
    await seedStoredDocument(execSql, "torn-down-doc");
    const doc = {} as unknown as DocumentState;
    const resolveProjectionUserKey = () => null;
    const state = {
      doc,
      localId: "torn-down-doc",
      resolveProjectionUserKey,
      runtime: {
        infra: { execSql },
        state: { containerId: null, domainScope: "scope" },
        util: { log: () => undefined },
      },
    } as unknown as DocumentStoreState;
    const generation = captureDocumentStoreSyncGeneration(state, doc);
    if (!generation) {
      throw new Error("expected a live document-store generation");
    }
    const handler = documentTerminalSubmitFailureHandler(state, generation);

    // Hold the serialized mutation as the "teardown": clear failure rows and
    // invalidate the generation while the handler queues behind it.
    let releaseTeardown = () => {};
    const teardownHeld = new Promise<void>((resolve) => {
      releaseTeardown = resolve;
    });
    const teardown = runSerializedSqlMutation(execSql, async (locked) => {
      await clearDocumentSyncFailure(locked, {
        appKind: "documents",
        localId: "torn-down-doc",
      });
      (state as { doc: unknown }).doc = null;
      await teardownHeld;
    });
    const queuedHandler = handler({ message: "terminal", status: 500 });
    releaseTeardown();
    await teardown;
    await queuedHandler;

    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
  } finally {
    close();
  }
});

// The real deletion path: a terminal handler racing the authoritative
// deletion queues behind its mutation, observes the in-mutation store
// invalidation, and records nothing.
test("a handler racing authoritative deletion records nothing", async () => {
  const { close, execSql } = await createTestExecSql("deletion-handler-race");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      {
        accessEpoch: 1,
        accessStateHash: null,
        containerId: "tombstoned-container",
        documentId: "remote-race",
        documentKind: "note",
        id: "race-doc",
        snapshotEndVersion: "",
        text: "queued edit",
        title: "queued edit",
      },
      { updatedAt: "2026-07-23T14:19:12.658Z" },
    );
    const record = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "race-doc",
    );
    if (!record) {
      throw new Error("expected seeded document record");
    }

    const doc = {} as unknown as DocumentState;
    const resolveProjectionUserKey = () => null;
    const state = {
      doc,
      listeners: new Set(),
      localId: "race-doc",
      localWriteGeneration: 0,
      locallyAcceptedUpdateIds: new Set(),
      persistence: sqlDocumentsPersistence,
      record,
      resolveProjectionUserKey,
      runtime: {
        infra: { documentProjectors: null, execSql },
        state: { containerId: null, domainScope: "scope" },
        util: { log: () => undefined },
      },
      snapshot: { attachments: [], attachmentStatusBySlotId: {} },
    } as unknown as DocumentStoreState;
    const generation = captureDocumentStoreSyncGeneration(state, doc);
    if (!generation) {
      throw new Error("expected a live document-store generation");
    }
    const handler = documentTerminalSubmitFailureHandler(state, generation);

    const deletion = deleteUpstreamDeletedDocument(
      state,
      generation,
      record,
      "remote-race",
    );
    const racingHandler = handler({ message: "terminal", status: 500 });
    await deletion;
    await racingHandler;

    expect(await hasRecordedTerminalSyncFailures(execSql)).toBe(false);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "race-doc"),
    ).toBeFalsy();
  } finally {
    close();
  }
});
