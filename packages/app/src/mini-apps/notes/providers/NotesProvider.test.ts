import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encryptLoroUpdate,
  exportAllUpdates,
  getUpdateVersionVectors,
  type SyncDocumentResponse,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createLargeText } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { createMemoryBlobStore } from "../../../data/blobs";
import {
  createDocumentEncryptionMaterial,
  getOrCreateDocumentEncryptionMaterial,
} from "../../../data/documentSync";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentsPersistence";
import {
  createEmptyDriverLicenseDocument,
  DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
} from "../../../document-types/drivers-license/driverLicenseDocument";
import {
  addNoteAttachments,
  ensureNoteAttachmentStructure,
} from "../noteDocument";
import type {
  LocalAttachmentRecord,
  NoteRecord,
  NoteSummary,
  NotesPersistence,
  PendingAttachmentRecord,
  PendingAttachmentReplacementRecord,
  PendingAttachmentRewrapRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "../notesPersistence";
import { createNotesStore, type NotesRuntime } from "./NotesProvider";

interface StoredNotesState {
  localAttachments: LocalAttachmentRecord[];
  note: NoteRecord | null;
  pendingAttachments: PendingAttachmentRecord[];
  pendingAttachmentReplacements: PendingAttachmentReplacementRecord[];
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
  commitLsn?: string | null;
  documentId: string;
  recipientEncapsulationPublicKeys: string[];
  acceptedOutgoingUpdateIds?: string[];
  canonicalDocumentRecipientEnvelopesAdopted?: boolean;
  documentRecipientEnvelopeAction?: SyncDocumentResponse["documentRecipientEnvelopeAction"];
  documentRecipientEnvelopes?: SyncDocumentResponse["documentRecipientEnvelopes"];
  missingUpdateEpochs?: SyncDocumentResponse["missingUpdateEpochs"];
  rotateBaselineSourceVersionVector?: string | null;
  updates?: SyncDocumentResponse["updates"];
}): SyncDocumentResponse {
  return {
    acceptedOutgoingUpdateIds: input.acceptedOutgoingUpdateIds ?? [],
    canonicalDocumentRecipientEnvelopesAdopted:
      input.canonicalDocumentRecipientEnvelopesAdopted ?? false,
    commitLsn: input.commitLsn ?? null,
    currentAccessEpoch: input.accessEpoch,
    documentId: input.documentId,
    documentRecipientEnvelopeAction:
      input.documentRecipientEnvelopeAction ?? "none",
    documentRecipientEnvelopes: input.documentRecipientEnvelopes ?? null,
    missingUpdateEpochs: input.missingUpdateEpochs ?? [],
    rotateBaselineSourceVersionVector:
      input.rotateBaselineSourceVersionVector ?? null,
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
  let pendingAttachmentReplacements: PendingAttachmentReplacementRecord[] = [];
  let pendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];

  return {
    async ensureSchema() {},
    getState() {
      return {
        localAttachments,
        note,
        pendingAttachments,
        pendingAttachmentReplacements,
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
    async listNotesByContainerIdsOrDocumentIds(_execSql, input) {
      if (!note) {
        return [];
      }

      const containerIds = new Set(input.containerIds);
      const documentIds = new Set(input.documentIds);
      const containerMatches =
        note.containerId !== null && containerIds.has(note.containerId);
      const documentMatches =
        note.documentId !== null && documentIds.has(note.documentId);
      if (!containerMatches && !documentMatches) {
        return [];
      }

      return [
        {
          id: note.id,
          containerId: note.containerId,
          documentId: note.documentId,
          title: note.text.trim() || "Untitled note",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      ];
    },
    async loadNote() {
      return note;
    },
    async saveNote(_execSql, nextNote) {
      note = nextNote;
      return "2026-04-06T00:00:00.000Z";
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
    async relinkPersistedNote(_execSql, input) {
      if (!note || note.id !== input.noteId) {
        return null;
      }

      note = {
        ...note,
        accessEpoch: Math.max(note.accessEpoch, input.accessEpoch),
        containerId: input.containerId,
        documentId: input.documentId,
        documentRecipientEnvelopes:
          input.accessEpoch > note.accessEpoch
            ? null
            : note.documentRecipientEnvelopes,
      };

      return {
        id: note.id,
        containerId: note.containerId,
        documentId: note.documentId,
        title: note.text.trim() || "Untitled note",
        updatedAt: "2026-04-06T00:00:00.000Z",
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
    async listPendingAttachmentReplacements() {
      return pendingAttachmentReplacements;
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
          sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
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
    async savePendingAttachmentReplacement(_execSql, attachment) {
      pendingAttachmentReplacements = [
        ...pendingAttachmentReplacements.filter(
          (existingAttachmentReplacement) =>
            !(
              existingAttachmentReplacement.noteId === attachment.noteId &&
              existingAttachmentReplacement.slotId === attachment.slotId
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
    async deletePendingAttachmentReplacement(_execSql, noteId, slotId) {
      pendingAttachmentReplacements = pendingAttachmentReplacements.filter(
        (attachmentReplacement) =>
          !(
            attachmentReplacement.noteId === noteId &&
            attachmentReplacement.slotId === slotId
          ),
      );
    },
    async deletePendingAttachmentReplacements(_execSql, noteId) {
      pendingAttachmentReplacements = pendingAttachmentReplacements.filter(
        (attachmentReplacement) => attachmentReplacement.noteId !== noteId,
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
  const runtimeBase = await createSqlRuntimeBase("notes-provider-test");

  return {
    ...runtimeBase,
    apiClient: {
      commitDocumentChange: async () => null,
      createDocument: async (_linkedContainerIds) => null,
      getBlob: async () => null,
      listDocumentAttachments: async () => null,
      stageBlob: async () => null,
      syncDocument: async () => null,
    },
    containerId: "root-container",
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
    attachmentStatusBySlotId: {},
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
    attachmentStatusBySlotId: {},
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

test("document store seeds initial text before first persistence", async () => {
  const persistence = createNotesPersistence();
  const runtime = createRuntime();
  const initialText = createEmptyDriverLicenseDocument();
  const store = createNotesStore(
    "driver-license",
    runtime,
    persistence,
    undefined,
    null,
    initialText,
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  expect(store.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: true,
    syncing: false,
    text: initialText,
  });
  expect(persistence.getState().note?.text).toBe(initialText);
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
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

test("notes store can bind an attachment to a fixed slot id", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const commitChangeCalls: Array<{
    documentId: string;
    referencedSlotIds: string[];
  }> = [];
  const runtime = createSyncRuntime(encapsulationKeyPair, "identity-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      commitDocumentChange: async (documentId, input) => {
        commitChangeCalls.push({
          documentId,
          referencedSlotIds: input.loroUpdate?.referencedSlotIds ?? [],
        });
        return runtime.apiClient.commitDocumentChange(documentId, input);
      },
    },
  };

  const store = createNotesStore(
    "drivers-license-note",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Fixed-slot attachment store did not become ready.",
  );

  store.setAttachment(DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID, {
    bytes: new TextEncoder().encode("front image bytes"),
    mimeType: "image/jpeg",
    name: "front.jpg",
  });

  await waitForCondition(
    () =>
      commitChangeCalls.length === 1 &&
      persistence.getState().note?.documentId === "notes-document-1" &&
      store.getSnapshot().attachments.length === 1 &&
      store.getSnapshot().attachments[0]?.slotId ===
        DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
    "Fixed-slot attachment was not committed.",
  );

  expect(store.getSnapshot().attachments).toEqual([
    {
      byteLength: "front image bytes".length,
      mimeType: "image/jpeg",
      name: "front.jpg",
      slotId: DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
    },
  ]);
  expect(commitChangeCalls).toEqual([
    {
      documentId: "notes-document-1",
      referencedSlotIds: [DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID],
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

test("notes store probes document sync before committing offline attachment drafts", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    referencedSlotIds: string[];
    sourceVersionVector: string | null;
  }> = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateCount: number;
    postReconnectProbe: boolean;
  }> = [];
  let currentDocumentRecipientEnvelopes: SyncDocumentResponse["documentRecipientEnvelopes"] =
    null;
  let returnRotateOnNextSync = false;

  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    blobStore,
    apiClient: {
      ...runtime.apiClient,
      commitDocumentChange: async (documentId, input) => {
        currentDocumentRecipientEnvelopes =
          input.documentRecipientEnvelopes ?? currentDocumentRecipientEnvelopes;
        commitChangeCalls.push({
          accessEpoch: input.accessEpoch,
          attachmentCommitCount: input.attachmentCommits.length,
          documentId,
          documentRecipientEnvelopeCount:
            input.documentRecipientEnvelopes?.length ?? 0,
          referencedSlotIds: input.loroUpdate?.referencedSlotIds ?? [],
          sourceVersionVector: input.loroUpdate?.sourceVersionVector ?? null,
        });

        return {
          acceptedOutgoingUpdateIds: input.loroUpdate
            ? [input.loroUpdate.id]
            : [],
          committedBindings: input.attachmentCommits.map((commit, index) => ({
            bindingId: `binding-${index + 1}`,
            blobId: `blob-${index + 1}`,
            slotId: commit.slotId,
          })),
          currentAccessEpoch: input.accessEpoch,
          documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
          detachedBindingIds: [],
        };
      },
      listDocumentAttachments: async () => [],
      stageBlob: async (input) => runtime.apiClient.stageBlob(input),
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        const postReconnectProbe = returnRotateOnNextSync;
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateCount: outgoingUpdates.length,
          postReconnectProbe,
        });
        if (documentRecipientEnvelopes) {
          currentDocumentRecipientEnvelopes = documentRecipientEnvelopes;
        }

        if (returnRotateOnNextSync) {
          returnRotateOnNextSync = false;
          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rotate",
            rotateBaselineSourceVersionVector: "offline-rotate-frontier",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
          });
        }

        const synced = await runtime.apiClient.syncDocument(
          documentId,
          accessEpoch,
          localVersionVector,
          outgoingUpdates,
          documentRecipientEnvelopes,
        );
        currentDocumentRecipientEnvelopes =
          synced?.documentRecipientEnvelopes ??
          currentDocumentRecipientEnvelopes;
        return synced;
      },
    },
  };
  const offlineRuntime: NotesRuntime = {
    ...instrumentedRuntime,
    isAuthenticated: false,
    online: false,
  };

  const store = createNotesStore(
    "offline-attachment-rotate",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline rotate attachment notes store did not become ready.",
  );

  store.setText("remote baseline");

  await waitForCondition(
    () =>
      persistence.getState().note?.documentId === "notes-document-1" &&
      persistence.getState().pendingUpdates.length === 0,
    "Initial document sync did not complete before offline attachment.",
  );

  const initialSyncCallCount = syncDocumentCalls.length;
  store.updateRuntime(offlineRuntime);
  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline attachment after rotate"),
      mimeType: "image/png",
      name: "offline-after-rotate.png",
    },
  ]);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingUpdates.length === 1,
    "Offline attachment draft was not persisted.",
  );

  returnRotateOnNextSync = true;
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () =>
      commitChangeCalls.length === 1 &&
      persistence.getState().note?.accessEpoch === 2 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingUpdates.length === 0,
    "Offline attachment draft was not committed after rotate discovery.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId ?? "";
  expect(syncDocumentCalls.slice(initialSyncCallCount)[0]).toEqual({
    accessEpoch: 1,
    documentId: "notes-document-1",
    documentRecipientEnvelopeCount: 0,
    outgoingUpdateCount: 0,
    postReconnectProbe: true,
  });
  expect(commitChangeCalls).toEqual([
    {
      accessEpoch: 2,
      attachmentCommitCount: 1,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      referencedSlotIds: [slotId],
      sourceVersionVector: "offline-rotate-frontier",
    },
  ]);
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
          ":appKind": DOCUMENTS_APP_KIND,
          ":localId": noteId,
        },
      );

      const projectionRows = await runtime.execSql(
        `
          SELECT length(text) AS text_length
          FROM document_projection
          WHERE local_id = :localId
        `,
        {
          ":localId": noteId,
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
        ":appKind": DOCUMENTS_APP_KIND,
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

test("notes store rewraps document access expansion without replacing pending updates with a baseline", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const createDocumentCalls: string[][] = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateIds: string[];
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
          outgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: [],
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
    "Expanded access epoch did not rewrap and retry the pending note update.",
  );

  expect(createDocumentCalls).toEqual([["root-container"]]);
  expect(
    syncDocumentCalls.map((call) => ({
      accessEpoch: call.accessEpoch,
      documentId: call.documentId,
      documentRecipientEnvelopeCount: call.documentRecipientEnvelopeCount,
      outgoingUpdateCount: call.outgoingUpdateCount,
    })),
  ).toEqual([
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
  expect(syncDocumentCalls[1]?.outgoingUpdateIds).toHaveLength(1);
  expect(syncDocumentCalls[3]?.outgoingUpdateIds).toEqual(
    syncDocumentCalls[1]?.outgoingUpdateIds,
  );
});

test("notes store persists commitLsn and reuses it as minLsn on the next sync", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  let syncCallCount = 0;

  const runtime = createSyncRuntime(encapsulationKeyPair);
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      syncDocument: async (
        documentId,
        accessEpoch,
        _localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
        minLsn,
      ) => {
        syncCallCount += 1;
        syncDocumentCalls.push({
          minLsn: minLsn ?? null,
          outgoingUpdateCount: outgoingUpdates.length,
        });

        return createSyncDocumentResponse({
          acceptedOutgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          accessEpoch,
          commitLsn: syncCallCount === 1 ? "0/10" : "0/20",
          documentId,
          documentRecipientEnvelopes: documentRecipientEnvelopes ?? null,
          recipientEncapsulationPublicKeys: [
            bytesToBase64(encapsulationKeyPair.publicKey),
          ],
        });
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
      syncDocumentCalls.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.lastCommitLsn === "0/10",
    "Initial note document sync did not persist the returned commitLsn.",
  );

  store.setText("hello again");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.lastCommitLsn === "0/20",
    "Follow-up note sync did not reuse and refresh the persisted commitLsn.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/10",
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
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingUpdateIds: string[];
    outgoingUpdateCount: number;
  }> = [];
  let currentBindingId: string | null = null;
  let currentBlobId: string | null = null;
  let currentDocumentRecipientEnvelopes: SyncDocumentResponse["documentRecipientEnvelopes"] =
    null;
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
        currentDocumentRecipientEnvelopes =
          input.documentRecipientEnvelopes ?? currentDocumentRecipientEnvelopes;

        return {
          acceptedOutgoingUpdateIds: input.loroUpdate
            ? [input.loroUpdate.id]
            : [],
          committedBindings,
          currentAccessEpoch: input.accessEpoch,
          documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
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
        syncDocumentCalls.push({
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingUpdateIds: outgoingUpdates.map((update) => update.id),
          outgoingUpdateCount: outgoingUpdates.length,
        });
        if (documentRecipientEnvelopes) {
          currentDocumentRecipientEnvelopes = documentRecipientEnvelopes;
        }

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: [],
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
      syncDocumentCalls.some(
        (call) =>
          call.accessEpoch === 2 &&
          call.outgoingUpdateCount === 1 &&
          call.documentRecipientEnvelopeCount === 0,
      ) &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingAttachmentRewraps.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
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
      documentRecipientEnvelopeCount: 0,
      expectedBindingIds: ["binding-1-1"],
      referencedSlotIds: [],
    },
  ]);
  const stalePendingUpdate = syncDocumentCalls.find(
    (call) => call.accessEpoch === 1 && call.outgoingUpdateCount === 1,
  );
  const retriedPendingUpdate = syncDocumentCalls.find(
    (call) => call.accessEpoch === 2 && call.outgoingUpdateCount === 1,
  );
  expect(stalePendingUpdate?.outgoingUpdateIds).toHaveLength(1);
  expect(retriedPendingUpdate?.outgoingUpdateIds).toEqual(
    stalePendingUpdate?.outgoingUpdateIds,
  );
});

test("notes store replaces committed attachments after document rotate", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    attachmentRewrapCount: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    expectedBindingIds: Array<string | null>;
    referencedSlotIds: string[];
    sourceVersionVector: string | null;
  }> = [];
  let currentBindingId: string | null = null;
  let currentBlobId: string | null = null;
  let currentSlotId: string | null = null;
  let syncCallCount = 0;
  let commitCallCount = 0;
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingSourceVersionVectors: Array<string | null>;
    outgoingUpdateCount: number;
  }> = [];

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
          sourceVersionVector: input.loroUpdate?.sourceVersionVector ?? null,
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
        if (!currentBlobId || !currentBindingId || !currentSlotId) {
          return null;
        }

        if (blobId !== currentBlobId) {
          return null;
        }

        return {
          blobId,
          encryptedBytes: "",
          sha256: "",
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
          outgoingSourceVersionVectors: outgoingUpdates.map(
            (update) => update.sourceVersionVector ?? null,
          ),
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (syncCallCount === 2) {
          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rotate",
            rotateBaselineSourceVersionVector: "rotate-frontier-1",
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
    "attachment-rotation",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment rotation notes store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("attachment before rotate"),
      mimeType: "image/png",
      name: "before-rotate.png",
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

  store.setText("hello after rotate");

  await waitForCondition(
    () =>
      commitChangeCalls.length === 2 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingAttachmentReplacements.length === 0 &&
      persistence.getState().pendingAttachmentRewraps.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.accessEpoch === 2,
    "Rotate access epoch did not trigger committed attachment replacement.",
  );

  expect(commitChangeCalls).toEqual([
    {
      accessEpoch: 1,
      attachmentCommitCount: 1,
      attachmentRewrapCount: 0,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      expectedBindingIds: [null],
      referencedSlotIds: [currentSlotId ?? ""],
      sourceVersionVector: expect.any(String),
    },
    {
      accessEpoch: 2,
      attachmentCommitCount: 1,
      attachmentRewrapCount: 0,
      documentId: "notes-document-1",
      documentRecipientEnvelopeCount: 1,
      expectedBindingIds: ["binding-1-1"],
      referencedSlotIds: [currentSlotId ?? ""],
      sourceVersionVector: "rotate-frontier-1",
    },
  ]);
  expect(syncDocumentCalls).toContainEqual({
    accessEpoch: 1,
    documentId: "notes-document-1",
    documentRecipientEnvelopeCount: 0,
    outgoingSourceVersionVectors: [],
    outgoingUpdateCount: 0,
  });
  expect(syncDocumentCalls).toContainEqual({
    accessEpoch: 1,
    documentId: "notes-document-1",
    documentRecipientEnvelopeCount: 1,
    outgoingSourceVersionVectors: [null],
    outgoingUpdateCount: 1,
  });
  expect(
    syncDocumentCalls.some(
      (call) => call.accessEpoch === 2 && call.outgoingUpdateCount === 1,
    ),
  ).toBe(false);
});

test("notes store asks for replacement when rotated attachment bytes are not local", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const slotId = "slot-needs-replacement";
  const existingDoc = await createDocument("missing-local-attachment");
  ensureNoteAttachmentStructure(existingDoc);
  addNoteAttachments(existingDoc, [
    {
      byteLength: "old attachment".length,
      mimeType: "image/png",
      name: "old.png",
      slotId,
    },
  ]);
  await persistence.saveNote(async () => [], {
    accessEpoch: 1,
    containerId: "shared-container",
    documentId: "notes-document-1",
    documentRecipientEnvelopes: null,
    id: "missing-local-attachment",
    loroSnapshot: bytesToBase64(exportAllUpdates(existingDoc)),
    text: "",
  });

  const commitChangeCalls: Array<{
    accessEpoch: number;
    attachmentCommitCount: number;
    documentRecipientEnvelopeCount: number;
    expectedBindingIds: Array<string | null>;
    referencedSlotIds: string[];
    sourceVersionVector: string | null;
  }> = [];
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    outgoingUpdateCount: number;
  }> = [];
  let shouldRotate = true;
  let currentBindingId = "binding-before-rotate";
  let currentBlobId = "blob-before-rotate";
  let commitCount = 0;

  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const instrumentedRuntime: NotesRuntime = {
    ...runtime,
    apiClient: {
      ...runtime.apiClient,
      commitDocumentChange: async (_documentId, input) => {
        commitCount += 1;
        commitChangeCalls.push({
          accessEpoch: input.accessEpoch,
          attachmentCommitCount: input.attachmentCommits.length,
          documentRecipientEnvelopeCount:
            input.documentRecipientEnvelopes?.length ?? 0,
          expectedBindingIds: input.attachmentCommits.map(
            (commit) => commit.expectedBindingId,
          ),
          referencedSlotIds: input.loroUpdate?.referencedSlotIds ?? [],
          sourceVersionVector: input.loroUpdate?.sourceVersionVector ?? null,
        });
        const committedBindings = input.attachmentCommits.map((commit) => {
          currentBindingId = `binding-after-replacement-${commitCount}`;
          currentBlobId = `blob-after-replacement-${commitCount}`;

          return {
            bindingId: currentBindingId,
            blobId: currentBlobId,
            slotId: commit.slotId,
          };
        });

        return {
          acceptedOutgoingUpdateIds: input.loroUpdate
            ? [input.loroUpdate.id]
            : [],
          committedBindings,
          currentAccessEpoch: input.accessEpoch,
          documentRecipientEnvelopes: input.documentRecipientEnvelopes ?? null,
          detachedBindingIds: ["binding-before-rotate"],
        };
      },
      getBlob: async () => null,
      listDocumentAttachments: async () => [
        {
          bindingId: currentBindingId,
          blobId: currentBlobId,
          slotId,
        },
      ],
      stageBlob: async (input) => runtime.apiClient.stageBlob(input),
      syncDocument: async (
        documentId,
        accessEpoch,
        localVersionVector,
        outgoingUpdates,
        documentRecipientEnvelopes,
      ) => {
        syncDocumentCalls.push({
          accessEpoch,
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (shouldRotate) {
          shouldRotate = false;
          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rotate",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
            rotateBaselineSourceVersionVector: "missing-local-rotate-frontier",
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
    "missing-local-attachment",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachmentReplacements.length === 1 &&
      store.getSnapshot().attachmentStatusBySlotId[slotId] ===
        "needs_replacement",
    "Rotated attachment without local bytes was not marked for replacement.",
  );

  expect(persistence.getState().pendingAttachments).toEqual([]);
  expect(
    syncDocumentCalls.some(
      (call) => call.accessEpoch === 2 && call.outgoingUpdateCount > 0,
    ),
  ).toBe(false);

  store.replaceAttachment(slotId, {
    bytes: new TextEncoder().encode("replacement bytes"),
    mimeType: "image/png",
    name: "replacement.png",
  });

  await waitForCondition(
    () =>
      commitChangeCalls.length === 1 &&
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingAttachmentReplacements.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
      store.getSnapshot().attachmentStatusBySlotId[slotId] === undefined,
    "Selected replacement attachment was not committed.",
  );

  expect(store.getSnapshot().attachments).toEqual([
    {
      byteLength: "replacement bytes".length,
      mimeType: "image/png",
      name: "replacement.png",
      slotId,
    },
  ]);
  expect(commitChangeCalls).toEqual([
    {
      accessEpoch: 2,
      attachmentCommitCount: 1,
      documentRecipientEnvelopeCount: 1,
      expectedBindingIds: ["binding-before-rotate"],
      referencedSlotIds: [slotId],
      sourceVersionVector: "missing-local-rotate-frontier",
    },
  ]);
});

test("notes store builds rotate baselines over decryptable prior-epoch updates", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair);
  let shouldRotateNextEpochOneSync = false;
  let epochOneDocumentRecipientEnvelopes: SyncDocumentResponse["documentRecipientEnvelopes"] =
    null;
  const remoteUpdateVectorRef: { partialEndVersionVector: string | null } = {
    partialEndVersionVector: null,
  };
  let rotateBaselinePartialEndVersionVector: string | null = null;
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentId: string;
    documentRecipientEnvelopeCount: number;
    outgoingSourceVersionVectors: Array<string | null>;
    outgoingUpdateCount: number;
  }> = [];

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
          accessEpoch,
          documentId,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingSourceVersionVectors: outgoingUpdates.map(
            (update) => update.sourceVersionVector ?? null,
          ),
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (documentRecipientEnvelopes) {
          epochOneDocumentRecipientEnvelopes = documentRecipientEnvelopes;
        }

        const rotateBaseline = outgoingUpdates.find(
          (update) => update.sourceVersionVector === "rotate-frontier-2",
        );
        if (accessEpoch === 2 && rotateBaseline) {
          rotateBaselinePartialEndVersionVector =
            rotateBaseline.partialEndVersionVector;
        }

        if (
          shouldRotateNextEpochOneSync &&
          accessEpoch === 1 &&
          outgoingUpdates.length > 0
        ) {
          shouldRotateNextEpochOneSync = false;
          if (!epochOneDocumentRecipientEnvelopes) {
            throw new Error("Missing epoch one document recipient envelopes.");
          }

          const remoteDoc = await createDocument("notes-rotate-prior-update");
          remoteDoc.getText("text").update("remote prior-epoch update");
          const remoteUpdate = exportAllUpdates(remoteDoc);
          const remoteUpdateVectors = getUpdateVersionVectors(remoteUpdate);
          remoteUpdateVectorRef.partialEndVersionVector =
            remoteUpdateVectors.partialEndVersionVector;
          const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
            documentRecipientEnvelopes: epochOneDocumentRecipientEnvelopes,
            execSql: instrumentedRuntime.execSql,
            recipientPublicKeys: [encapsulationKeyPair.publicKey],
            secretKey: encapsulationKeyPair.secretKey,
          });

          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rotate",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
            rotateBaselineSourceVersionVector: "rotate-frontier-2",
            missingUpdateEpochs: ["prior_epoch"],
            updates: [
              {
                accessEpoch: 1,
                authorFingerprint: "remote-author",
                createdAt: "2026-04-09T00:00:00.000Z",
                documentId,
                encryptedData: await encryptLoroUpdate(
                  remoteUpdate,
                  1,
                  documentKey,
                ),
                id: "remote-update-before-rotate",
                partialEndVersionVector:
                  remoteUpdateVectors.partialEndVersionVector,
                partialStartVersionVector:
                  remoteUpdateVectors.partialStartVersionVector,
              },
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
    "rotate-prior-updates",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Rotate prior-update notes store did not become ready.",
  );

  store.setText("local text before rotate");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.documentRecipientEnvelopes !== null,
    "Epoch one note update did not persist document recipient envelopes.",
  );

  shouldRotateNextEpochOneSync = true;
  store.setText("local text after rotate");

  await waitForCondition(
    () =>
      rotateBaselinePartialEndVersionVector !== null &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.accessEpoch === 2,
    "Rotate baseline did not sync after importing prior-epoch updates.",
  );

  if (
    !remoteUpdateVectorRef.partialEndVersionVector ||
    !rotateBaselinePartialEndVersionVector
  ) {
    throw new Error("Rotate baseline or remote update vectors were not set.");
  }
  expect(
    satisfiesVersionVector(
      rotateBaselinePartialEndVersionVector,
      remoteUpdateVectorRef.partialEndVersionVector,
    ),
  ).toBe(true);
  expect(syncDocumentCalls).toContainEqual({
    accessEpoch: 2,
    documentId: "notes-document-1",
    documentRecipientEnvelopeCount: 1,
    outgoingSourceVersionVectors: ["rotate-frontier-2"],
    outgoingUpdateCount: 1,
  });
});

test("notes store adopts the canonical bundle after losing a rotate race", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const canonicalEncryptionMaterial = await createDocumentEncryptionMaterial([
    encapsulationKeyPair.publicKey,
  ]);
  const runtime = createSyncRuntime(encapsulationKeyPair);
  let shouldRotateNextEpochOneSync = false;
  let returnedCanonicalBundle = false;
  let acceptedCanonicalRetry = false;
  const syncDocumentCalls: Array<{
    accessEpoch: number;
    documentRecipientEnvelopeCount: number;
    outgoingSourceVersionVectors: Array<string | null>;
    outgoingUpdateCount: number;
  }> = [];

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
          accessEpoch,
          documentRecipientEnvelopeCount:
            documentRecipientEnvelopes?.length ?? 0,
          outgoingSourceVersionVectors: outgoingUpdates.map(
            (update) => update.sourceVersionVector ?? null,
          ),
          outgoingUpdateCount: outgoingUpdates.length,
        });

        if (
          shouldRotateNextEpochOneSync &&
          accessEpoch === 1 &&
          outgoingUpdates.length > 0
        ) {
          shouldRotateNextEpochOneSync = false;
          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "rotate",
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
            rotateBaselineSourceVersionVector: "rotate-frontier-3",
          });
        }

        const isRotateBaselineRetry =
          accessEpoch === 2 &&
          outgoingUpdates.some(
            (update) => update.sourceVersionVector === "rotate-frontier-3",
          );
        if (
          isRotateBaselineRetry &&
          documentRecipientEnvelopes &&
          !returnedCanonicalBundle
        ) {
          returnedCanonicalBundle = true;
          expect(documentRecipientEnvelopes).not.toEqual(
            canonicalEncryptionMaterial.documentRecipientEnvelopes,
          );
          return createSyncDocumentResponse({
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "none",
            documentRecipientEnvelopes:
              canonicalEncryptionMaterial.documentRecipientEnvelopes,
            recipientEncapsulationPublicKeys: [
              bytesToBase64(encapsulationKeyPair.publicKey),
            ],
          });
        }

        if (
          isRotateBaselineRetry &&
          !documentRecipientEnvelopes &&
          returnedCanonicalBundle
        ) {
          acceptedCanonicalRetry = true;
          return createSyncDocumentResponse({
            acceptedOutgoingUpdateIds: outgoingUpdates.map(
              (update) => update.id,
            ),
            accessEpoch: 2,
            documentId,
            documentRecipientEnvelopeAction: "none",
            documentRecipientEnvelopes:
              canonicalEncryptionMaterial.documentRecipientEnvelopes,
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
    "rotate-canonical-adoption",
    instrumentedRuntime,
    persistence,
  );
  store.updateRuntime(instrumentedRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Rotate canonical adoption notes store did not become ready.",
  );

  store.setText("local text before losing rotate");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.documentRecipientEnvelopes !== null,
    "Epoch one note update did not sync before rotate race.",
  );

  shouldRotateNextEpochOneSync = true;
  store.setText("local text after losing rotate");

  await waitForCondition(
    () =>
      returnedCanonicalBundle &&
      acceptedCanonicalRetry &&
      persistence.getState().pendingUpdates.length === 0,
    "Notes store did not adopt the canonical bundle and retry the baseline.",
  );

  expect(
    JSON.parse(
      String(persistence.getState().note?.documentRecipientEnvelopes ?? ""),
    ),
  ).toEqual(canonicalEncryptionMaterial.documentRecipientEnvelopes);
  expect(syncDocumentCalls).toContainEqual({
    accessEpoch: 2,
    documentRecipientEnvelopeCount: 1,
    outgoingSourceVersionVectors: ["rotate-frontier-3"],
    outgoingUpdateCount: 1,
  });
  expect(syncDocumentCalls).toContainEqual({
    accessEpoch: 2,
    documentRecipientEnvelopeCount: 0,
    outgoingSourceVersionVectors: ["rotate-frontier-3"],
    outgoingUpdateCount: 1,
  });
});
