import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { SyncDocumentResponse } from "@tearleads/loro";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { createLargeText } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createMemoryBlobStore } from "../../data/blob-store";
import { createNotesStore, type NotesRuntime } from "./NotesProvider";
import type {
  LocalAttachmentRecord,
  NoteRecord,
  NoteSummary,
  NotesPersistence,
  PendingAttachmentRecord,
  PendingAttachmentRewrapRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "./notesPersistence";

interface StoredNotesState {
  localAttachments: LocalAttachmentRecord[];
  note: NoteRecord | null;
  pendingAttachments: PendingAttachmentRecord[];
  pendingAttachmentRewraps: PendingAttachmentRewrapRecord[];
  noteSummaries: NoteSummary[];
  pendingUpdates: PendingUpdateRecord[];
}

interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

interface ProjectionLengthRow {
  text_length: number | string | null;
}

function createSyncDocumentResponse(input: {
  accessEpoch: number;
  documentId: string;
  recipientEncapsulationPublicKeys: string[];
  acceptedOutgoingUpdateIds?: string[];
  documentRecipientEnvelopeAction?: SyncDocumentResponse["documentRecipientEnvelopeAction"];
  documentRecipientEnvelopes?: SyncDocumentResponse["documentRecipientEnvelopes"];
  updates?: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  return {
    acceptedOutgoingUpdateIds: input.acceptedOutgoingUpdateIds ?? [],
    currentAccessEpoch: input.accessEpoch,
    documentId: input.documentId,
    documentRecipientEnvelopeAction:
      input.documentRecipientEnvelopeAction ?? "none",
    documentRecipientEnvelopes: input.documentRecipientEnvelopes ?? null,
    recipientEncapsulationPublicKeys: input.recipientEncapsulationPublicKeys,
    updates: input.updates ?? [],
  };
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
  let localAttachments: LocalAttachmentRecord[] = [];
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];

  return {
    async ensureSchema() {},
    getState() {
      return {
        localAttachments,
        note,
        pendingAttachments,
        pendingAttachmentRewraps,
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
      const nextNote = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        documentRecipientEnvelopes: note?.documentRecipientEnvelopes ?? null,
        id: note?.id ?? input.documentId,
        loroSnapshot: note?.loroSnapshot ?? "",
        text: note?.text ?? "",
      };
      note = nextNote;

      return {
        id: nextNote.id,
        containerId: nextNote.containerId,
        documentId: nextNote.documentId,
        title: nextNote.text.trim() || "Untitled note",
        updatedAt: input.createdAt,
      };
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async listPendingAttachments() {
      return pendingAttachments;
    },
    async listPendingAttachmentRewraps() {
      return pendingAttachmentRewraps;
    },
    async listLocalAttachments() {
      return localAttachments;
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
    async saveLocalAttachment(_execSql, attachment) {
      localAttachments = [
        ...localAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.noteId === attachment.noteId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async savePendingAttachment(_execSql, attachment) {
      pendingAttachments = [
        ...pendingAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.noteId === attachment.noteId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async savePendingAttachmentRewrap(_execSql, attachment) {
      pendingAttachmentRewraps = [
        ...pendingAttachmentRewraps.filter(
          (existingAttachmentRewrap) =>
            !(
              existingAttachmentRewrap.noteId === attachment.noteId &&
              existingAttachmentRewrap.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deletePendingAttachments(_execSql, noteId) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) => attachment.noteId !== noteId,
      );
    },
    async deletePendingAttachmentRewraps(_execSql, noteId) {
      pendingAttachmentRewraps = pendingAttachmentRewraps.filter(
        (attachmentRewrap) => attachmentRewrap.noteId !== noteId,
      );
    },
  };
}

function createRuntime(containerId = "root-container"): NotesRuntime {
  return {
    apiClient: {
      commitDocumentChange: async () => null,
      createDocument: async (_linkedContainerIds) => null,
      getBlob: async () => null,
      listDocumentAttachments: async () => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
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
      commitDocumentChange: async (_documentId, input) => ({
        acceptedOutgoingUpdateIds: input.loroUpdate
          ? [input.loroUpdate.id]
          : [],
        committedBindings: input.attachmentCommits.map((commit, index) => ({
          bindingId: `binding-${index + 1}`,
          blobId: `blob-${index + 1}`,
          slotId: commit.slotId,
        })),
        currentAccessEpoch: 1,
        documentRecipientEnvelopes: null,
        detachedBindingIds: [],
      }),
      createDocument: async (_linkedContainerIds) => ({
        id: "notes-document-1",
        createdAt: "2026-03-31T00:00:00.000Z",
        currentAccessEpoch: 1,
        documentRecipientEnvelopes: null,
        recipientEncapsulationPublicKeys: [
          bytesToBase64(encapsulationKeyPair.publicKey),
        ],
      }),
      getBlob: async () => null,
      listDocumentAttachments: async () => [],
      stageBlob: async () => ({
        expiresAt: "2026-04-07T00:00:00.000Z",
        stageId: crypto.randomUUID(),
      }),
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) =>
        createSyncDocumentResponse({
          acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          accessEpoch,
          documentId,
          documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
          recipientEncapsulationPublicKeys: [
            bytesToBase64(encapsulationKeyPair.publicKey),
          ],
        }),
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
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

function createOfflineAttachmentRuntime(
  encapsulationKeyPair: NonNullable<NotesRuntime["encapsulationKeyPair"]>,
  containerId = "root-container",
): NotesRuntime {
  return {
    apiClient: {
      commitDocumentChange: async () => null,
      createDocument: async () => null,
      getBlob: async () => null,
      listDocumentAttachments: async () => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
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
      commitDocumentChange: async () => null,
      createDocument: async (_linkedContainerIds) => null,
      getBlob: async () => null,
      listDocumentAttachments: async () => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
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
    attachments: [],
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
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
    attachments: [],
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: true,
    syncing: false,
    text: "persisted note",
  });
});

test("notes store creates a document linked to the configured container", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const cachedPrincipalReferences: Array<
    ReadonlyArray<{
      keyEpoch: number;
      principalId: string;
      principalType: "group" | "organization";
      stateHash: string;
      version: number;
    }>
  > = [];
  const createDocumentCalls: string[][] = [];
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    cacheReferencedPrincipalPolicies: async (references) => {
      cachedPrincipalReferences.push(references ?? []);
    },
    apiClient: {
      ...runtime.apiClient,
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        const created =
          await runtime.apiClient.createDocument(linkedContainerIds);
        if (!created) {
          return null;
        }

        return {
          ...created,
          referencedPrincipals: [
            {
              keyEpoch: 1,
              principalId: "group-1",
              principalType: "group",
              stateHash: "state-hash-1",
              version: 1,
            },
          ],
        };
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
  expect(cachedPrincipalReferences).toContainEqual([
    {
      keyEpoch: 1,
      principalId: "group-1",
      principalType: "group",
      stateHash: "state-hash-1",
      version: 1,
    },
  ]);
});

test("notes store stages and commits attachments against the note document", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[][] = [];
  const stageBlobCalls: Array<{
    byteLength: number;
    encryptedBytes: string;
    sha256: string;
  }> = [];
  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    documentId: string;
    referencedSlotIds: string[];
  }> = [];
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      commitDocumentChange: async (documentId, input) => {
        commitChangeCalls.push({
          accessEpoch: input.accessEpoch,
          attachmentCommitCount: input.attachmentCommits.length,
          documentId,
          referencedSlotIds: input.loroUpdate?.referencedSlotIds ?? [],
        });
        return runtime.apiClient.commitDocumentChange(documentId, input);
      },
      createDocument: async (linkedContainerIds) => {
        createDocumentCalls.push(linkedContainerIds);
        return runtime.apiClient.createDocument(linkedContainerIds);
      },
      stageBlob: async (input) => {
        stageBlobCalls.push(input);
        return runtime.apiClient.stageBlob(input);
      },
    },
  };

  const store = createNotesStore(
    "attachment-note",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment-capable notes store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("hello attachment"),
      mimeType: "text/plain",
      name: "hello.txt",
    },
  ]);

  await waitForCondition(
    () =>
      createDocumentCalls.length === 1 &&
      stageBlobCalls.length === 1 &&
      commitChangeCalls.length === 1 &&
      store.getSnapshot().attachments.length === 1 &&
      store.getSnapshot().attachments[0]?.name === "hello.txt" &&
      persistence.getState().note?.documentId === "notes-document-1",
    "Attachment flow did not create, stage, and commit the note change.",
  );

  expect(createDocumentCalls).toEqual([["shared-container"]]);
  expect(stageBlobCalls[0]?.encryptedBytes.length).toBeGreaterThan(0);
  expect(stageBlobCalls[0]?.byteLength).toBeGreaterThan(0);
  expect(stageBlobCalls[0]?.sha256.length).toBeGreaterThan(0);
  expect(commitChangeCalls).toEqual([
    {
      accessEpoch: 1,
      attachmentCommitCount: 1,
      documentId: "notes-document-1",
      referencedSlotIds: [store.getSnapshot().attachments[0]?.slotId ?? ""],
    },
  ]);
});

test("notes store attaches files locally without authentication or network", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createOfflineAttachmentRuntime(
    encapsulationKeyPair,
    "offline-container",
  );
  const offlineRuntime: NotesRuntime = {
    ...runtime,
    blobStore,
  };
  const store = createNotesStore(
    "offline-attachment-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline attachment notes store did not become ready.",
  );

  expect(store.getSnapshot().canAttach).toBe(true);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 &&
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingAttachments[0]?.name === "offline.png",
    "Offline attachment was not stored locally.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  const storageKey = slotId
    ? store.getSnapshot().attachmentStorageKeyBySlotId[slotId]
    : undefined;
  const persistedBytes = storageKey
    ? await blobStore.readBytes(storageKey)
    : null;

  expect(storageKey).toBeString();
  expect(new TextDecoder().decode(persistedBytes ?? new Uint8Array())).toBe(
    "offline bytes",
  );
});

test("notes store keeps prior attachments when a second file is attached", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const store = createNotesStore("attachment-sequence", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Sequential attachment note store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("first"),
      mimeType: "image/png",
      name: "first.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 1,
    "First attachment did not persist.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("second"),
      mimeType: "image/png",
      name: "second.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 2,
    "Second attachment did not persist.",
  );

  expect(
    store.getSnapshot().attachments.map((attachment) => attachment.name),
  ).toEqual(["first.png", "second.png"]);
});

test("notes store reloads persisted attachment metadata from the note snapshot", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair);
  const firstStore = createNotesStore(
    "attachment-reload",
    runtime,
    persistence,
  );
  firstStore.updateRuntime(runtime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First attachment note store did not become ready.",
  );

  firstStore.attachFiles([
    {
      bytes: new TextEncoder().encode("persisted attachment"),
      mimeType: "text/plain",
      name: "persisted.txt",
    },
  ]);

  await waitForCondition(
    () => firstStore.getSnapshot().attachments.length === 1,
    "Attachment metadata was not persisted to the first note store.",
  );

  const secondStore = createNotesStore(
    "attachment-reload",
    createRuntime(),
    persistence,
  );
  secondStore.updateRuntime(createRuntime());

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second attachment note store did not become ready.",
  );

  expect(secondStore.getSnapshot().attachments).toEqual([
    {
      byteLength: "persisted attachment".length,
      mimeType: "text/plain",
      name: "persisted.txt",
      slotId: firstStore.getSnapshot().attachments[0]?.slotId ?? "",
    },
  ]);
});

test("notes store skips hydrating attachment blobs whose digest does not match", async () => {
  const initialPersistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const logMessages: string[] = [];
  const initialRuntime = createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
  );
  const initialStore = createNotesStore(
    "tampered-attachment-note",
    initialRuntime,
    initialPersistence,
  );
  initialStore.updateRuntime(initialRuntime);

  await waitForCondition(
    () => initialStore.getSnapshot().ready,
    "Initial tampered attachment note store did not become ready.",
  );

  initialStore.attachFiles([
    {
      bytes: new TextEncoder().encode("hello attachment"),
      mimeType: "image/png",
      name: "hello.png",
    },
  ]);

  await waitForCondition(
    () =>
      initialPersistence.getState().note?.documentId === "notes-document-1" &&
      initialPersistence.getState().pendingAttachments.length === 0,
    "Initial attachment sync did not complete before tamper check.",
  );

  const persistedNote = initialPersistence.getState().note;
  const persistedSlotId = initialStore.getSnapshot().attachments[0]?.slotId;
  expect(persistedNote).toBeDefined();
  expect(persistedSlotId).toBeString();

  const hydratedPersistence = createNotesPersistence();
  if (persistedNote) {
    await hydratedPersistence.saveNote(async () => [], persistedNote);
  }

  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      getBlob: async () => ({
        blobId: "blob-1",
        encryptedBytes: "tampered-encrypted-bytes",
        sha256: "wrong-digest",
      }),
      listDocumentAttachments: async () => [
        {
          bindingId: "binding-1",
          blobId: "blob-1",
          slotId: persistedSlotId ?? "",
        },
      ],
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
        _documentRecipientEnvelopes,
      ) =>
        createSyncDocumentResponse({
          acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          accessEpoch,
          documentId,
          recipientEncapsulationPublicKeys: [
            bytesToBase64(encapsulationKeyPair.publicKey),
          ],
        }),
    },
    log: (message) => {
      logMessages.push(message);
    },
  };
  const store = createNotesStore(
    "tampered-attachment-note",
    instrumentedRuntime,
    hydratedPersistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Tampered attachment note store did not become ready.",
  );

  await waitForCondition(
    () =>
      logMessages.some((message) =>
        message.includes("sha256 mismatch during hydration"),
      ),
    "Tampered blob hydration was not rejected.",
  );

  expect(
    store.getSnapshot().attachmentStorageKeyBySlotId[persistedSlotId ?? ""],
  ).toBe(undefined);
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
    documentRecipientEnvelopeCount: number;
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
        documentRecipientEnvelopes,
      ) => {
        syncCallCount += 1;
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: outgoingUpdates.map(
              (update) => update.id,
            ),
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rewrap",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
          });
        }

        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
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
      syncDocumentCalls.length === 4 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.accessEpoch === 2,
    "Expanded access epoch did not trigger a full baseline resync.",
  );

  expect(createDocumentCalls).toEqual([["root-container"]]);
  expect(syncDocumentCalls).toEqual([
    {
      accessEpoch: 1,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 1,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 1,
    },
    {
      accessEpoch: 2,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      outgoingUpdateCount: 0,
    },
    {
      accessEpoch: 2,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 1,
    },
  ]);
});

test("notes store does not invent document recipient envelopes during read-only sync", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateCount: number;
  }> = [];

  await persistence.saveNote(async () => [], {
    accessEpoch: 1,
    containerId: "root-container",
    documentId: "notes-document-1",
    documentRecipientEnvelopes: null,
    id: "default",
    loroSnapshot: "",
    text: "",
  });

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        syncDocumentCalls.push({
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateCount: outgoingUpdates.length,
        });

        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        );
      },
    },
  };

  const store = createNotesStore("default", instrumentedRuntime, persistence);
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => syncDocumentCalls.length === 1,
    "Read-only notes sync did not run.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 0,
      outgoingUpdateCount: 0,
    },
  ]);
});

test("notes store rewraps committed attachments when document access expands", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const stageBlobCalls: Array<{
    byteLength: number;
    encryptedBytes: string;
    sha256: string;
  }> = [];
  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    attachmentRewrapCount: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    expectedBindingIds: Array<string | null>;
    referencedSlotIds: string[];
  }> = [];
  let currentBindingId: string | null = null;
  let currentBlobId: string | null = null;
  let currentSlotId: string | null = null;
  let syncCallCount = 0;
  let commitCallCount = 0;

  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      commitDocumentChange: async (documentId, input) => {
        commitCallCount += 1;
        commitChangeCalls.push({
          accessEpoch: input.accessEpoch,
          attachmentCommitCount: input.attachmentCommits.length,
          attachmentRewrapCount: input.attachmentRewraps.length,
          documentId,
          documentRecipientEnvelopeCount:
            input.documentRecipientEnvelopes?.length ?? 0,
          expectedBindingIds: [
            ...input.attachmentCommits.map(
              (commit) => commit.expectedBindingId,
            ),
            ...input.attachmentRewraps.map(
              (attachmentRewrap) => attachmentRewrap.expectedBindingId,
            ),
          ],
          referencedSlotIds: input.loroUpdate?.referencedSlotIds ?? [],
        });

        const committedBindings = input.attachmentCommits.map(
          (commit, index) => {
            const bindingId = `binding-${commitCallCount}-${index + 1}`;
            const blobId = `blob-${commitCallCount}-${index + 1}`;
            currentBindingId = bindingId;
            currentBlobId = blobId;

            return {
              bindingId,
              blobId,
              slotId: commit.slotId,
            };
          },
        );

        return {
          acceptedOutgoingUpdateIds: input.loroUpdate
            ? [input.loroUpdate.id]
            : [],
          committedBindings,
          currentAccessEpoch: input.accessEpoch,
          documentRecipientEnvelopes: null,
          detachedBindingIds: [],
        };
      },
      getBlob: async (blobId) => {
        if (!currentBlobId || blobId !== currentBlobId || !stageBlobCalls[0]) {
          return null;
        }

        return {
          blobId,
          encryptedBytes: stageBlobCalls[0].encryptedBytes,
          sha256: stageBlobCalls[0].sha256,
        };
      },
      listDocumentAttachments: async () => {
        if (!currentBindingId || !currentBlobId || !currentSlotId) {
          return [];
        }

        return [
          {
            bindingId: currentBindingId,
            blobId: currentBlobId,
            slotId: currentSlotId,
          },
        ];
      },
      stageBlob: async (input) => {
        stageBlobCalls.push(input);
        return runtime.apiClient.stageBlob(input);
      },
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        syncCallCount += 1;

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: outgoingUpdates.map(
              (update) => update.id,
            ),
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rewrap",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
          });
        }

        return runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        );
      },
    },
  };

  const store = createNotesStore(
    "attachment-access-expansion",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment re-commit notes store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("attachment before share"),
      mimeType: "image/png",
      name: "before-share.png",
    },
  ]);

  await waitForCondition(
    () =>
      commitChangeCalls.length === 1 &&
      persistence.getState().pendingAttachments.length === 0,
    "Initial attachment commit did not complete.",
  );

  currentSlotId = store.getSnapshot().attachments[0]?.slotId ?? null;
  expect(currentSlotId).toBeString();

  store.setText("hello again");

  await waitForCondition(
    () =>
      commitChangeCalls.length === 2 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingAttachmentRewraps.length === 0 &&
      persistence.getState().note?.accessEpoch === 2,
    "Access expansion did not trigger attachment rewrap.",
  );

  expect(stageBlobCalls).toHaveLength(1);
  expect(commitChangeCalls).toEqual([
    {
      accessEpoch: 1,
      attachmentCommitCount: 1,
      attachmentRewrapCount: 0,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      expectedBindingIds: [null],
      referencedSlotIds: [currentSlotId ?? ""],
    },
    {
      accessEpoch: 2,
      attachmentCommitCount: 0,
      attachmentRewrapCount: 1,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      expectedBindingIds: ["binding-1-1"],
      referencedSlotIds: [currentSlotId ?? ""],
    },
  ]);
});
