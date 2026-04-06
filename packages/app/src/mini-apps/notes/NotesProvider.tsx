import { bytesToHex, encryptForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  encryptLoroUpdate,
  exportAllUpdates,
  exportUpdatesSince,
  getTextValue,
  importUpdates,
} from "@tearleads/loro";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobStore } from "../../data/blob-store";
import {
  decryptBlobEnvelope,
  serializeBlobEnvelope,
} from "../../data/blobEnvelope";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createPendingUpdateFields,
  decryptIncomingUpdates,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../data/documentSync";
import {
  getNoteAttachments,
  type NoteAttachment,
  sameNoteAttachments,
  setNoteAttachments,
} from "./noteDocument";
import {
  deriveNoteTitle,
  type LocalAttachmentRecord,
  type NoteRecord,
  type NoteSummary,
  type NotesPersistence,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  sqlNotesPersistence,
} from "./notesPersistence";

type NotesDocument = Awaited<ReturnType<typeof createDocument>>;
type NotesAppData = ReturnType<typeof useAppData>;
export const DEFAULT_NOTE_ID = "default";

function sameAttachmentStorageKeys(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([slotId, storageKey]) => right[slotId] === storageKey)
  );
}

export interface NotesRuntime {
  apiClient: Pick<
    NotesAppData["apiClient"],
    | "commitDocumentChange"
    | "createDocument"
    | "getBlob"
    | "listDocumentAttachments"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  containerId: NotesAppData["containerId"];
  dbStatus: NotesAppData["dbStatus"];
  domainScope: NotesAppData["domainScope"];
  encapsulationKeyPair: NotesAppData["encapsulationKeyPair"];
  events: NotesAppData["events"];
  execSql: NotesAppData["execSql"];
  isAuthenticated: NotesAppData["isAuthenticated"];
  log: NotesAppData["log"];
  online: NotesAppData["online"];
}

interface NoteAttachmentUpload {
  bytes: Uint8Array;
  name: string;
  mimeType: string | null;
}

interface NotesContextValue {
  attachments: ReadonlyArray<NoteAttachment>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface NotesSnapshot {
  attachments: ReadonlyArray<NoteAttachment>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
}

interface NotesStore {
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  getSnapshot: () => NotesSnapshot;
  setPersistedNoteListener: (
    listener: PersistedNoteListener | undefined,
  ) => void;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: NotesRuntime) => void;
}

type PersistedNoteListener = (note: NoteSummary) => void;

const notesStoresByScope = new WeakMap<object, Map<string, NotesStore>>();
const NotesContext = createContext<NotesStore | null>(null);

export function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence: NotesPersistence = sqlNotesPersistence,
  onPersistedNote?: PersistedNoteListener,
): NotesStore {
  let runtime = initialRuntime;
  let persistedNoteListener = onPersistedNote;
  let snapshot: NotesSnapshot = {
    attachments: [],
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: false,
    text: "",
    syncing: false,
  };
  let doc: NotesDocument | null = null;
  let record: NoteRecord | null = null;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let syncRequested = false;
  let writeChain = Promise.resolve();
  let lastEventCount = 0;
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let attachmentStorageKeyBySlotId: Record<string, string> = {};
  let recipientPublicKeys = getLocalRecipientPublicKeys(
    runtime.encapsulationKeyPair,
  );
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: NotesSnapshot) {
    if (
      sameNoteAttachments(snapshot.attachments, next.attachments) &&
      sameAttachmentStorageKeys(
        snapshot.attachmentStorageKeyBySlotId,
        next.attachmentStorageKeyBySlotId,
      ) &&
      snapshot.canAttach === next.canAttach &&
      snapshot.documentId === next.documentId &&
      snapshot.ready === next.ready &&
      snapshot.text === next.text &&
      snapshot.syncing === next.syncing
    ) {
      return;
    }

    snapshot = next;
    emit();
  }

  function updateRecipientPublicKeys(encodedPublicKeys: string[]) {
    recipientPublicKeys = resolveRecipientPublicKeys(
      encodedPublicKeys,
      getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
    );
  }

  function resetStore() {
    doc = null;
    record = null;
    pendingAttachments = [];
    attachmentStorageKeyBySlotId = {};
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve();
    recipientPublicKeys = getLocalRecipientPublicKeys(
      runtime.encapsulationKeyPair,
    );
    setSnapshot({
      attachments: [],
      attachmentStorageKeyBySlotId: {},
      canAttach: false,
      documentId: null,
      ready: false,
      text: "",
      syncing: false,
    });
  }

  function canAttachFiles(): boolean {
    return runtime.dbStatus === "ready" && !!runtime.encapsulationKeyPair;
  }

  function getSnapshotAttachments(
    currentDoc: NotesDocument | null = doc,
  ): NoteAttachment[] {
    return currentDoc ? getNoteAttachments(currentDoc) : [];
  }

  function getAttachmentStorageKeys(
    attachments: ReadonlyArray<NoteAttachment>,
  ): Record<string, string> {
    const nextStorageKeys: Record<string, string> = {};

    for (const attachment of attachments) {
      const storageKey = attachmentStorageKeyBySlotId[attachment.slotId];
      if (storageKey) {
        nextStorageKeys[attachment.slotId] = storageKey;
      }
    }

    return nextStorageKeys;
  }

  function setReadySnapshot(
    currentDoc: NotesDocument,
    syncing: boolean,
    text = getTextValue(currentDoc),
  ) {
    setSnapshot({
      attachments: getSnapshotAttachments(currentDoc),
      attachmentStorageKeyBySlotId: getAttachmentStorageKeys(
        getSnapshotAttachments(currentDoc),
      ),
      canAttach: canAttachFiles(),
      documentId: record?.documentId ?? null,
      ready: true,
      text,
      syncing,
    });
  }

  async function createNotesDocument() {
    return createDocument(getScopedPeerSeed("notes"));
  }

  async function ensureRemoteDocument(
    currentDoc: NotesDocument,
    nextRecord: NoteRecord | null,
  ): Promise<NoteRecord | null> {
    if (nextRecord?.documentId) {
      return nextRecord;
    }

    if (!runtime.containerId) {
      runtime.log(
        "Notes: cannot create a remote document without a container.",
      );
      return nextRecord;
    }

    const created = await runtime.apiClient.createDocument([
      runtime.containerId,
    ]);
    if (!created) {
      return nextRecord;
    }

    updateRecipientPublicKeys(created.recipientEncapsulationPublicKeys);
    runtime.log(`Created notes document: ${created.id}`);

    return persistDocument(currentDoc, {
      documentId: created.id,
      accessEpoch: created.currentAccessEpoch,
    });
  }

  async function createEncryptedBlobUpload(
    upload: NoteAttachmentUpload,
    recipientKeys: Uint8Array[],
  ): Promise<{
    byteLength: number;
    encryptedBytes: string;
    sha256: string;
  }> {
    const encryptedEnvelope = await encryptForRecipients(
      upload.bytes,
      recipientKeys,
    );
    const encryptedBytes = serializeBlobEnvelope(encryptedEnvelope);
    const encodedEnvelope = new TextEncoder().encode(encryptedBytes);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encodedEnvelope),
    );

    return {
      byteLength: encodedEnvelope.byteLength,
      encryptedBytes,
      sha256: bytesToHex(digest),
    };
  }

  async function saveNoteRecord(nextRecord: NoteRecord) {
    await persistence.saveNote(runtime.execSql, nextRecord);
    record = nextRecord;
    persistedNoteListener?.({
      id: nextRecord.id,
      containerId: nextRecord.containerId,
      documentId: nextRecord.documentId,
      title: deriveNoteTitle(nextRecord.text),
      updatedAt: new Date().toISOString(),
    });
  }

  async function persistDocument(
    currentDoc: NotesDocument,
    patch: Partial<NoteRecord> = {},
  ): Promise<NoteRecord> {
    const nextRecord: NoteRecord = {
      id: record?.id ?? noteId,
      containerId:
        patch.containerId ?? record?.containerId ?? runtime.containerId ?? null,
      documentId: patch.documentId ?? record?.documentId ?? null,
      text: patch.text ?? getTextValue(currentDoc),
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
      accessEpoch: patch.accessEpoch ?? record?.accessEpoch ?? 1,
    };

    await saveNoteRecord(nextRecord);
    setReadySnapshot(currentDoc, snapshot.syncing, nextRecord.text);
    return nextRecord;
  }

  async function listPendingUpdates(): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, noteId);
  }

  async function listPendingAttachmentRecords(): Promise<
    PendingAttachmentRecord[]
  > {
    return persistence.listPendingAttachments(runtime.execSql, noteId);
  }

  async function listLocalAttachmentRecords() {
    return persistence.listLocalAttachments(runtime.execSql, noteId);
  }

  async function enqueuePendingUpdate(update: Uint8Array) {
    const pendingUpdateFields = createPendingUpdateFields(update);
    if (!pendingUpdateFields) {
      return;
    }

    await persistence.enqueuePendingUpdate(runtime.execSql, {
      noteId,
      ...pendingUpdateFields,
    });
  }

  async function deletePendingUpdate(id: string) {
    await persistence.deletePendingUpdate(runtime.execSql, id);
  }

  async function saveLocalAttachmentRecord(
    attachment: LocalAttachmentRecord,
    currentDoc: NotesDocument | null = doc,
  ) {
    await persistence.saveLocalAttachment(runtime.execSql, attachment);
    attachmentStorageKeyBySlotId = {
      ...attachmentStorageKeyBySlotId,
      [attachment.slotId]: attachment.storageKey,
    };

    if (currentDoc) {
      setReadySnapshot(
        currentDoc,
        snapshot.syncing,
        currentDoc === doc ? snapshot.text : getTextValue(currentDoc),
      );
    }
  }

  async function hydrateAttachmentBlobs(
    currentDoc: NotesDocument,
    currentRecord: NoteRecord | null,
  ) {
    if (
      !runtime.encapsulationKeyPair ||
      !runtime.isAuthenticated ||
      !runtime.online ||
      !currentRecord?.documentId
    ) {
      return;
    }

    const currentAttachments = getNoteAttachments(currentDoc);
    if (currentAttachments.length === 0) {
      return;
    }

    const attachmentsMissingLocalBytes = currentAttachments.filter(
      (attachment) => !attachmentStorageKeyBySlotId[attachment.slotId],
    );
    if (attachmentsMissingLocalBytes.length === 0) {
      return;
    }

    const attachmentBindings = await runtime.apiClient.listDocumentAttachments(
      currentRecord.documentId,
    );
    if (!attachmentBindings) {
      return;
    }

    const bindingBySlotId = new Map(
      attachmentBindings.map((binding) => [binding.slotId, binding]),
    );

    for (const attachment of attachmentsMissingLocalBytes) {
      const binding = bindingBySlotId.get(attachment.slotId);
      if (!binding) {
        continue;
      }

      const blob = await runtime.apiClient.getBlob(binding.blobId);
      if (!blob) {
        continue;
      }

      const decryptedBytes = await decryptBlobEnvelope(
        blob.encryptedBytes,
        runtime.encapsulationKeyPair.secretKey,
      );
      const storageKey = `blob-${binding.blobId}`;
      await runtime.blobStore.writeBytes(storageKey, decryptedBytes);
      await saveLocalAttachmentRecord(
        {
          blobId: binding.blobId,
          byteLength: attachment.byteLength,
          mimeType: attachment.mimeType,
          noteId,
          slotId: attachment.slotId,
          storageKey,
        },
        currentDoc,
      );
    }
  }

  async function replacePendingUpdatesWithBaseline(currentDoc: NotesDocument) {
    await persistence.deletePendingUpdates(runtime.execSql, noteId);
    await enqueuePendingUpdate(exportAllUpdates(currentDoc));
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);

    const nextDoc = await createNotesDocument();
    const [existing, loadedPendingAttachments, localAttachments] =
      await Promise.all([
        persistence.loadNote(runtime.execSql, noteId),
        listPendingAttachmentRecords(),
        listLocalAttachmentRecords(),
      ]);
    pendingAttachments = loadedPendingAttachments;
    attachmentStorageKeyBySlotId = Object.fromEntries(
      localAttachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    );

    if (existing) {
      if (existing.loroSnapshot.length > 0) {
        importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
      }

      record = existing;
      setReadySnapshot(nextDoc, false);
    } else {
      const created: NoteRecord = {
        id: noteId,
        containerId: runtime.containerId ?? null,
        documentId: null,
        text: "",
        loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
        accessEpoch: 1,
      };
      await saveNoteRecord(created);
      setReadySnapshot(nextDoc, false, "");
    }

    doc = nextDoc;
    initialized = true;
    initializePromise = null;
    scheduleSync();
  }

  function ensureInitialized() {
    if (initialized || initializePromise || runtime.dbStatus !== "ready") {
      return;
    }

    initializePromise = initialize().catch((error: unknown) => {
      initializePromise = null;

      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    });
  }

  function scheduleSync() {
    syncRequested = true;

    if (syncPromise) {
      return;
    }

    syncPromise = (async () => {
      while (syncRequested) {
        syncRequested = false;

        if (
          !doc ||
          !snapshot.ready ||
          !runtime.online ||
          !runtime.isAuthenticated ||
          !runtime.encapsulationKeyPair
        ) {
          continue;
        }

        setSnapshot({
          attachments: snapshot.attachments,
          attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
          canAttach: snapshot.canAttach,
          documentId: snapshot.documentId,
          ready: snapshot.ready,
          text: snapshot.text,
          syncing: true,
        });

        try {
          let nextRecord = record;
          const encapsulationKeyPair = runtime.encapsulationKeyPair;

          if (!nextRecord || !encapsulationKeyPair) {
            continue;
          }

          if (pendingAttachments.length > 0) {
            let attachmentSyncCompleted = false;

            writeChain = writeChain
              .catch(() => undefined)
              .then(async () => {
                const currentDoc = doc;
                const currentRecord = record;

                if (
                  !currentDoc ||
                  !currentRecord ||
                  !runtime.online ||
                  !runtime.isAuthenticated
                ) {
                  return;
                }

                const nextRemoteRecord = await ensureRemoteDocument(
                  currentDoc,
                  currentRecord,
                );
                if (!nextRemoteRecord?.documentId) {
                  return;
                }

                const attachmentsToCommit = [...pendingAttachments];
                if (attachmentsToCommit.length === 0) {
                  return;
                }

                const attachmentCommits: Array<{
                  expectedBindingId: null;
                  slotId: string;
                  stageId: string;
                }> = [];

                for (const attachment of attachmentsToCommit) {
                  const localBytes = await runtime.blobStore.readBytes(
                    attachment.storageKey,
                  );
                  if (!localBytes) {
                    runtime.log(
                      `Notes: missing local blob bytes for attachment ${attachment.slotId}.`,
                    );
                    return;
                  }

                  const stagedBlob = await createEncryptedBlobUpload(
                    {
                      bytes: localBytes,
                      mimeType: attachment.mimeType,
                      name: attachment.name,
                    },
                    recipientPublicKeys,
                  );
                  const stage = await runtime.apiClient.stageBlob(stagedBlob);

                  if (!stage) {
                    return;
                  }

                  attachmentCommits.push({
                    expectedBindingId: null,
                    slotId: attachment.slotId,
                    stageId: stage.stageId,
                  });
                }

                const baselineUpdate = exportAllUpdates(currentDoc);
                const baselineUpdateFields =
                  createPendingUpdateFields(baselineUpdate);
                if (!baselineUpdateFields) {
                  return;
                }

                const encryptedBaseline = await encryptLoroUpdate(
                  baselineUpdate,
                  recipientPublicKeys,
                );
                const committed = await runtime.apiClient.commitDocumentChange(
                  nextRemoteRecord.documentId,
                  {
                    accessEpoch: nextRemoteRecord.accessEpoch,
                    attachmentCommits,
                    attachmentDetaches: [],
                    loroUpdate: {
                      encryptedData: encryptedBaseline,
                      id: crypto.randomUUID(),
                      partialEndVersionVector:
                        baselineUpdateFields.partialEndVersionVector,
                      partialStartVersionVector:
                        baselineUpdateFields.partialStartVersionVector,
                      referencedSlotIds: getNoteAttachments(currentDoc).map(
                        (attachment) => attachment.slotId,
                      ),
                    },
                  },
                );

                if (!committed) {
                  return;
                }

                for (const committedBinding of committed.committedBindings) {
                  const localAttachment = attachmentsToCommit.find(
                    (attachment) =>
                      attachment.slotId === committedBinding.slotId,
                  );
                  if (!localAttachment) {
                    continue;
                  }

                  await saveLocalAttachmentRecord(
                    {
                      blobId: committedBinding.blobId,
                      byteLength: localAttachment.byteLength,
                      mimeType: localAttachment.mimeType,
                      noteId,
                      slotId: localAttachment.slotId,
                      storageKey: localAttachment.storageKey,
                    },
                    currentDoc,
                  );
                }

                pendingAttachments = pendingAttachments.filter(
                  (pendingAttachment) =>
                    !attachmentsToCommit.some(
                      (attachmentToCommit) =>
                        attachmentToCommit.slotId === pendingAttachment.slotId,
                    ),
                );
                await persistence.deletePendingAttachments(
                  runtime.execSql,
                  noteId,
                );
                await persistence.deletePendingUpdates(runtime.execSql, noteId);
                nextRecord = await persistDocument(currentDoc, {
                  accessEpoch: committed.currentAccessEpoch,
                  documentId: nextRemoteRecord.documentId,
                });
                attachmentSyncCompleted = true;
              })
              .catch((error: unknown) => {
                console.error("Failed to sync note attachments:", error);
              });

            await writeChain;

            if (attachmentSyncCompleted) {
              syncRequested = true;
              continue;
            }
          }

          const pendingUpdates = await listPendingUpdates();
          let documentId = nextRecord.documentId;

          if (!documentId && pendingUpdates.length > 0) {
            nextRecord = await ensureRemoteDocument(doc, nextRecord);
            documentId = nextRecord?.documentId ?? null;
            if (!documentId) {
              continue;
            }
          }

          if (documentId) {
            const currentRecord = nextRecord;
            if (!currentRecord) {
              continue;
            }

            const outgoingUpdates = await encryptPendingUpdates(
              pendingUpdates,
              recipientPublicKeys,
            );

            const synced = await runtime.apiClient.syncDocument(
              documentId,
              currentRecord.accessEpoch,
              encodeVersionVector(doc),
              outgoingUpdates,
            );

            if (!synced) {
              continue;
            }

            updateRecipientPublicKeys(synced.recipientEncapsulationPublicKeys);

            for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
              await deletePendingUpdate(acceptedOutgoingUpdateId);
            }

            if (synced.updates.length > 0) {
              const decrypted = await decryptIncomingUpdates(
                synced.updates,
                encapsulationKeyPair.secretKey,
                (message) => runtime.log(`Notes: ${message}`),
              );
              if (decrypted.length > 0) {
                importUpdates(doc, decrypted);
                setReadySnapshot(doc, true);
              }
            }

            const previousAccessEpoch = currentRecord.accessEpoch;
            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: synced.currentAccessEpoch,
            });

            if (synced.currentAccessEpoch !== previousAccessEpoch) {
              await replacePendingUpdatesWithBaseline(doc);
              syncRequested = true;
            }

            await hydrateAttachmentBlobs(doc, nextRecord);
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Database worker client has been destroyed."
          ) {
            return;
          }

          throw error;
        } finally {
          setSnapshot({
            attachments: snapshot.attachments,
            attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
            canAttach: snapshot.canAttach,
            documentId: snapshot.documentId,
            ready: snapshot.ready,
            text: snapshot.text,
            syncing: false,
          });
        }
      }

      syncPromise = null;
    })();
  }

  function handleRemoteEvents() {
    if (!record?.documentId) {
      lastEventCount = runtime.events.length;
      return;
    }

    const nextEvents = runtime.events.slice(lastEventCount);
    lastEventCount = runtime.events.length;

    if (
      nextEvents.some(
        (event) =>
          isDocumentUpdateCreatedEvent(event) &&
          event.documentId === record?.documentId,
      )
    ) {
      scheduleSync();
    }
  }

  return {
    attachFiles(files: ReadonlyArray<NoteAttachmentUpload>) {
      if (files.length === 0 || !doc) {
        return;
      }

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          const currentDoc = doc;
          const encapsulationKeyPair = runtime.encapsulationKeyPair;

          if (!currentDoc || !canAttachFiles() || !encapsulationKeyPair) {
            runtime.log("Notes: attachments require a local key package.");
            return;
          }

          const currentAttachments = getNoteAttachments(currentDoc);
          const nextAttachments = [...currentAttachments];
          const nextPendingAttachments: PendingAttachmentRecord[] = [];

          for (const file of files) {
            const slotId = crypto.randomUUID();
            const storageKey = `${noteId}-${slotId}`;
            nextPendingAttachments.push({
              byteLength: file.bytes.byteLength,
              mimeType: file.mimeType,
              name: file.name,
              noteId,
              slotId,
              storageKey,
            });
            nextAttachments.push({
              byteLength: file.bytes.byteLength,
              mimeType: file.mimeType,
              name: file.name,
              slotId,
            });
          }

          const previousVersion = encodeVersionVector(currentDoc);
          setNoteAttachments(currentDoc, nextAttachments);
          const attachmentUpdate = exportUpdatesSince(
            currentDoc,
            previousVersion,
          );
          if (attachmentUpdate.byteLength > 0) {
            await enqueuePendingUpdate(attachmentUpdate);
          }

          for (const [
            index,
            pendingAttachment,
          ] of nextPendingAttachments.entries()) {
            const sourceFile = files[index];
            if (!sourceFile) {
              continue;
            }

            await runtime.blobStore.writeBytes(
              pendingAttachment.storageKey,
              sourceFile.bytes,
            );
            await saveLocalAttachmentRecord({
              blobId: null,
              byteLength: pendingAttachment.byteLength,
              mimeType: pendingAttachment.mimeType,
              noteId,
              slotId: pendingAttachment.slotId,
              storageKey: pendingAttachment.storageKey,
            });
            await persistence.savePendingAttachment(
              runtime.execSql,
              pendingAttachment,
            );
          }

          pendingAttachments = [
            ...pendingAttachments,
            ...nextPendingAttachments,
          ];
          await persistDocument(currentDoc);
          runtime.log(
            runtime.online && runtime.isAuthenticated
              ? `Attached ${files.length} file${files.length === 1 ? "" : "s"} to note ${noteId}.`
              : `Stored ${files.length} attachment${files.length === 1 ? "" : "s"} locally for note ${noteId}.`,
          );
          scheduleSync();
        })
        .catch((error: unknown) => {
          console.error("Failed to attach note files:", error);
        });
    },
    getSnapshot() {
      return snapshot;
    },
    setPersistedNoteListener(listener) {
      persistedNoteListener = listener;
    },
    setText(value: string) {
      if (!doc) {
        return;
      }

      setSnapshot({
        attachments: snapshot.attachments,
        attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
        canAttach: snapshot.canAttach,
        documentId: snapshot.documentId,
        ready: snapshot.ready,
        text: value,
        syncing: snapshot.syncing,
      });

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          if (!doc) {
            return;
          }

          if (getTextValue(doc) === value) {
            return;
          }

          const previousTextVersion = encodeVersionVector(doc);
          doc.getText("text").update(value);
          const update = exportUpdatesSince(doc, previousTextVersion);

          await enqueuePendingUpdate(update);
          await persistDocument(doc, { text: value });
          scheduleSync();
        })
        .catch((error: unknown) => {
          console.error("Failed to persist note changes:", error);
        });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    updateRuntime(nextRuntime: NotesRuntime) {
      const previousRuntime = runtime;
      runtime = nextRuntime;
      if (!record?.documentId) {
        recipientPublicKeys = getLocalRecipientPublicKeys(
          runtime.encapsulationKeyPair,
        );
      }

      if (nextRuntime.dbStatus !== "ready") {
        if (snapshot.ready || initialized || initializePromise) {
          resetStore();
        }
        lastEventCount = nextRuntime.events.length;
        return;
      }

      if (snapshot.ready) {
        setSnapshot({
          attachments: snapshot.attachments,
          attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
          canAttach: canAttachFiles(),
          documentId: snapshot.documentId,
          ready: snapshot.ready,
          text: snapshot.text,
          syncing: snapshot.syncing,
        });
      }

      ensureInitialized();

      const regainedSyncPrerequisites =
        (!previousRuntime.online && nextRuntime.online) ||
        (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
        (!previousRuntime.encapsulationKeyPair &&
          !!nextRuntime.encapsulationKeyPair);

      handleRemoteEvents();

      if (snapshot.ready && regainedSyncPrerequisites) {
        scheduleSync();
      }
    },
  };
}

function getOrCreateNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
): NotesStore {
  const existingStores = notesStoresByScope.get(domainScope);
  if (existingStores) {
    const existingStore = existingStores.get(noteId);
    if (existingStore) {
      existingStore.setPersistedNoteListener(onPersistedNote);
      return existingStore;
    }
  }

  const nextStore = createNotesStore(
    noteId,
    runtime,
    sqlNotesPersistence,
    onPersistedNote,
  );
  const stores = existingStores ?? new Map<string, NotesStore>();
  stores.set(noteId, nextStore);
  notesStoresByScope.set(domainScope, stores);
  return nextStore;
}

export function primeNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
): NotesStore {
  const store = getOrCreateNotesStore(
    domainScope,
    noteId,
    runtime,
    onPersistedNote,
  );
  store.updateRuntime(runtime);
  return store;
}

interface NotesProviderProps extends PropsWithChildren {
  noteId?: string;
  containerId?: string | null;
  onPersistedNote?: PersistedNoteListener;
}

export function NotesProvider({
  children,
  noteId = DEFAULT_NOTE_ID,
  containerId,
  onPersistedNote,
}: NotesProviderProps) {
  const appData = useAppData();
  const runtime = useMemo(
    () =>
      containerId === undefined
        ? appData
        : {
            ...appData,
            containerId,
          },
    [appData, containerId],
  );
  const store = useMemo(
    () =>
      getOrCreateNotesStore(
        runtime.domainScope,
        noteId,
        runtime,
        onPersistedNote,
      ),
    [noteId, onPersistedNote, runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <NotesContext.Provider value={store}>{children}</NotesContext.Provider>
  );
}

export function useNotes(): NotesContextValue {
  const store = useContext(NotesContext);
  if (!store) {
    throw new Error("useNotes must be used within a NotesProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      attachments: snapshot.attachments,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      attachFiles: store.attachFiles,
      canAttach: snapshot.canAttach,
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
