import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { createLargeText } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createNotesStore, type NotesRuntime } from "./NotesProvider";
import type {
  NoteRecord,
  NoteSummary,
  NotesPersistence,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "./notesPersistence";

interface StoredNotesState {
  note: NoteRecord | null;
  noteSummaries: NoteSummary[];
  pendingUpdates: PendingUpdateRecord[];
}

interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

interface ProjectionLengthRow {
  text_length: number | string | null;
}

interface PendingUpdateDetailRow extends PendingUpdateLengthRow {
  partial_start_version_vector: string | null;
  partial_end_version_vector: string | null;
}

function readRowValue(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

function isPendingUpdateLengthRow(
  value: unknown,
): value is PendingUpdateLengthRow {
  const updateDataLength = readRowValue(value, "update_data_length");
  return (
    typeof updateDataLength === "number" ||
    typeof updateDataLength === "string" ||
    updateDataLength === null
  );
}

function isProjectionLengthRow(value: unknown): value is ProjectionLengthRow {
  const textLength = readRowValue(value, "text_length");
  return (
    typeof textLength === "number" ||
    typeof textLength === "string" ||
    textLength === null
  );
}

function isPendingUpdateDetailRow(
  value: unknown,
): value is PendingUpdateDetailRow {
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return (
    isPendingUpdateLengthRow(value) &&
    (typeof partialStartVersionVector === "string" ||
      partialStartVersionVector === null) &&
    (typeof partialEndVersionVector === "string" ||
      partialEndVersionVector === null)
  );
}

function createNotesPersistence(): NotesPersistence & {
  getState: () => StoredNotesState;
} {
  let note: NoteRecord | null = null;
  let pendingUpdates: PendingUpdateRecord[] = [];

  return {
    async ensureSchema() {},
    getState() {
      return {
        note,
        noteSummaries: note
          ? [
              {
                id: note.id,
                containerId: note.containerId,
                documentId: note.documentId,
                title: note.text.trim() || "Untitled note",
                updatedAt: "2026-04-06T00:00:00.000Z",
              },
            ]
          : [],
        pendingUpdates,
      };
    },
    async listNotes() {
      return note
        ? [
            {
              id: note.id,
              containerId: note.containerId,
              documentId: note.documentId,
              title: note.text.trim() || "Untitled note",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ]
        : [];
    },
    async loadNote() {
      return note;
    },
    async saveNote(_execSql, nextNote) {
      note = nextNote;
    },
    async upsertDiscoveredNote(_execSql, input) {
      note = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        id: note?.id ?? input.documentId,
        loroSnapshot: note?.loroSnapshot ?? "",
        text: note?.text ?? "",
      };

      return {
        id: note.id,
        containerId: note.containerId,
        documentId: note.documentId,
        title: note.text.trim() || "Untitled note",
        updatedAt: input.createdAt,
      };
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async enqueuePendingUpdate(_execSql, pendingUpdate: PendingUpdateInsert) {
      pendingUpdates = [
        ...pendingUpdates,
        {
          id: `pending-${pendingUpdates.length + 1}`,
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          updateData: pendingUpdate.updateData,
        },
      ];
    },
    async deletePendingUpdate(_execSql, id: string) {
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
    },
    async deletePendingUpdates() {
      pendingUpdates = [];
    },
  };
}

function createRuntime(containerId = "root-container"): NotesRuntime {
  return {
    apiClient: {
      createDocument: async (_linkedContainerIds) => null,
      syncDocument: async () => null,
    },
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

function createSyncRuntime(
  encapsulationKeyPair: NonNullable<NotesRuntime["encapsulationKeyPair"]>,
  containerId = "root-container",
): NotesRuntime {
  return {
    apiClient: {
      createDocument: async (_linkedContainerIds) => ({
        id: "notes-document-1",
        createdAt: "2026-03-31T00:00:00.000Z",
        currentAccessEpoch: 1,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
      ) => ({
        documentId,
        acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
        updates: [],
        currentAccessEpoch: accessEpoch,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
    },
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    online: true,
  };
}

async function createSqlRuntime(): Promise<
  NotesRuntime & {
    close: () => void;
  }
> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch;

  let db: Awaited<ReturnType<typeof initDatabase>>;
  try {
    db = await initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "notes-provider-test",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  return {
    apiClient: {
      createDocument: async (_linkedContainerIds) => null,
      syncDocument: async () => null,
    },
    close: () => db.close(),
    containerId: "root-container",
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async (sql, bind) =>
      execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

test("notes store reloads persisted note text and pending updates", async () => {
  const persistence = createNotesPersistence();

  const firstRuntime = createRuntime();
  const firstStore = createNotesStore("default", firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First notes store did not become ready.",
  );

  expect(firstStore.getSnapshot()).toEqual({
    ready: true,
    syncing: false,
    text: "",
  });

  firstStore.setText("persisted note");

  await waitForCondition(
    () => persistence.getState().note?.text === "persisted note",
    "Persisted note text was not written.",
  );

  await waitForCondition(
    () => persistence.getState().pendingUpdates.length === 1,
    "Pending note update was not enqueued.",
  );

  const secondRuntime = createRuntime();
  const secondStore = createNotesStore("default", secondRuntime, persistence);
  secondStore.updateRuntime(secondRuntime);

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second notes store did not become ready.",
  );

  expect(secondStore.getSnapshot()).toEqual({
    ready: true,
    syncing: false,
    text: "persisted note",
  });
});

test("notes store creates a document linked to the configured container", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[][] = [];
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        return runtime.apiClient.createDocument(linkedContainerIds);
      },
    },
  };

  const store = createNotesStore(
    "container-note",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Container-scoped notes store did not become ready.",
  );

  store.setText("shared container note");

  await waitForCondition(
    () =>
      createDocumentCalls.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.documentId === "notes-document-1" &&
      persistence.getState().note?.containerId === "shared-container",
    "Container-scoped note did not create and sync its document.",
  );

  expect(createDocumentCalls).toEqual([["shared-container"]]);
});

test("large note edits remain a single pending update row before sync", async () => {
  const runtime = await createSqlRuntime();

  try {
    const noteId = "large-note";
    const store = createNotesStore(noteId, runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "SQLite-backed notes store did not become ready.",
    );

    const largeText = createLargeText(1024 * 1024);
    store.setText(largeText);

    await waitForCondition(async () => {
      const pendingRows = await runtime.execSql(
        `
          SELECT
            id,
            length(update_data) AS update_data_length
          FROM document_pending_updates
          WHERE app_kind = :appKind AND local_id = :localId
        `,
        {
          ":appKind": "notes",
          ":localId": noteId,
        },
      );

      const projectionRows = await runtime.execSql(
        `
          SELECT length(text) AS text_length
          FROM note_projection
          WHERE note_id = :noteId
        `,
        {
          ":noteId": noteId,
        },
      );
      const pendingRow = pendingRows[0];
      const projectionRow = projectionRows[0];

      return (
        pendingRows.length === 1 &&
        isPendingUpdateLengthRow(pendingRow) &&
        isProjectionLengthRow(projectionRow) &&
        Number(pendingRow.update_data_length ?? 0) > 256 * 1024 &&
        Number(projectionRow.text_length ?? 0) === largeText.length
      );
    }, "Large note edit was not persisted as a single pending update.");

    const pendingRows = await runtime.execSql(
      `
        SELECT
          id,
          length(update_data) AS update_data_length,
          partial_start_version_vector,
          partial_end_version_vector
        FROM document_pending_updates
        WHERE app_kind = :appKind AND local_id = :localId
      `,
      {
        ":appKind": "notes",
        ":localId": noteId,
      },
    );
    const pendingRow = pendingRows[0];

    expect(pendingRows).toHaveLength(1);
    if (!isPendingUpdateDetailRow(pendingRow)) {
      throw new Error("Expected a pending update detail row.");
    }

    expect(Number(pendingRow.update_data_length ?? 0)).toBeGreaterThan(
      256 * 1024,
    );
    expect(pendingRow.partial_start_version_vector).toBeString();
    expect(pendingRow.partial_end_version_vector).toBeString();
  } finally {
    runtime.close();
  }
});

test("notes store enqueues a full baseline when document access expands", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[][] = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    outgoingUpdateCount: number;
  }> = [];
  let syncCallCount = 0;

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        return runtime.apiClient.createDocument(linkedContainerIds);
      },
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
      ) => {
        syncCallCount += 1;
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (syncCallCount === 2) {
          return {
            acceptedOutgoingUpdateIds: outgoingUpdates.map(
              (update) => update.id,
            ),
            currentAccessEpoch: 2,
            documentId,
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
            updates: [],
          };
        }

        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
        );
      },
    },
  };

  const store = createNotesStore("default", instrumentedRuntime, persistence);
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Notes sync store did not become ready.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      createDocumentCalls.length === 1 &&
      syncDocumentCalls.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.documentId === "notes-document-1",
    "Initial note document sync did not complete.",
  );

  store.setText("hello again");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 3 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.accessEpoch === 2,
    "Expanded access epoch did not trigger a full baseline resync.",
  );

  expect(createDocumentCalls).toEqual([["root-container"]]);
  expect(syncDocumentCalls).toEqual([
    {
      accessEpoch: 1,
      documentId: "notes-document-1",
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 1,
      documentId: "notes-document-1",
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 2,
      documentId: "notes-document-1",
      outgoingUpdateCount: 1,
    },
  ]);
});
