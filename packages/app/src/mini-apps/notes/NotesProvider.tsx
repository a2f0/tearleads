import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decryptLoroUpdate,
  encodeVersionVector,
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
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../data/documentSync";
import {
  type NoteRecord,
  type NotesPersistence,
  type PendingUpdateRecord,
  sqlNotesPersistence,
} from "./notesPersistence";

type NotesDocument = Awaited<ReturnType<typeof createDocument>>;
type NotesAppData = ReturnType<typeof useAppData>;

export interface NotesRuntime {
  apiClient: Pick<NotesAppData["apiClient"], "createDocument" | "syncDocument">;
  dbStatus: NotesAppData["dbStatus"];
  domainScope: NotesAppData["domainScope"];
  encapsulationKeyPair: NotesAppData["encapsulationKeyPair"];
  events: NotesAppData["events"];
  execSql: NotesAppData["execSql"];
  isAuthenticated: NotesAppData["isAuthenticated"];
  log: NotesAppData["log"];
  online: NotesAppData["online"];
}

interface NotesContextValue {
  ready: boolean;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface NotesSnapshot {
  ready: boolean;
  text: string;
  syncing: boolean;
}

interface NotesStore {
  getSnapshot: () => NotesSnapshot;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: NotesRuntime) => void;
}

const NOTE_ID = "default";
const notesStoresByScope = new WeakMap<object, Map<string, NotesStore>>();
const NotesContext = createContext<NotesStore | null>(null);

export function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence: NotesPersistence = sqlNotesPersistence,
): NotesStore {
  let runtime = initialRuntime;
  let snapshot: NotesSnapshot = {
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
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve();
    recipientPublicKeys = getLocalRecipientPublicKeys(
      runtime.encapsulationKeyPair,
    );
    setSnapshot({
      ready: false,
      text: "",
      syncing: false,
    });
  }

  async function saveNoteRecord(nextRecord: NoteRecord) {
    await persistence.saveNote(runtime.execSql, nextRecord);
    record = nextRecord;
  }

  async function persistDocument(
    currentDoc: NotesDocument,
    patch: Partial<NoteRecord> = {},
  ): Promise<NoteRecord> {
    const nextRecord: NoteRecord = {
      id: record?.id ?? noteId,
      documentId: patch.documentId ?? record?.documentId ?? null,
      text: patch.text ?? getTextValue(currentDoc),
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
      accessEpoch: patch.accessEpoch ?? record?.accessEpoch ?? 1,
    };

    await saveNoteRecord(nextRecord);
    setSnapshot({
      ready: true,
      text: nextRecord.text,
      syncing: snapshot.syncing,
    });
    return nextRecord;
  }

  async function listPendingUpdates(): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, noteId);
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

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);

    const nextDoc = await createDocument(getScopedPeerSeed("notes"));
    const existing = await persistence.loadNote(runtime.execSql, noteId);

    if (existing?.loroSnapshot) {
      importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
      record = existing;
      setSnapshot({
        ready: true,
        text: getTextValue(nextDoc),
        syncing: false,
      });
    } else {
      const created: NoteRecord = {
        id: noteId,
        documentId: null,
        text: "",
        loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
        accessEpoch: 1,
      };
      await saveNoteRecord(created);
      setSnapshot({
        ready: true,
        text: "",
        syncing: false,
      });
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

          const pendingUpdates = await listPendingUpdates();
          let documentId = nextRecord.documentId;

          if (!documentId && pendingUpdates.length > 0) {
            const created = await runtime.apiClient.createDocument();
            if (!created) {
              continue;
            }

            updateRecipientPublicKeys(created.recipientEncapsulationPublicKeys);
            documentId = created.id;
            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: created.currentAccessEpoch,
            });
            runtime.log(`Created notes document: ${created.id}`);
          }

          if (documentId) {
            const outgoingUpdates = await encryptPendingUpdates(
              pendingUpdates,
              recipientPublicKeys,
            );

            const synced = await runtime.apiClient.syncDocument(
              documentId,
              nextRecord.accessEpoch,
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
              const decrypted = await Promise.all(
                synced.updates.map((update) =>
                  decryptLoroUpdate(
                    update.encryptedData,
                    encapsulationKeyPair.secretKey,
                  ),
                ),
              );
              importUpdates(doc, decrypted);
              setSnapshot({
                ready: true,
                text: getTextValue(doc),
                syncing: true,
              });
            }

            const previousAccessEpoch = nextRecord.accessEpoch;
            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: synced.currentAccessEpoch,
            });

            if (
              pendingUpdates.length > 0 &&
              synced.currentAccessEpoch !== previousAccessEpoch
            ) {
              syncRequested = true;
            }
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
    getSnapshot() {
      return snapshot;
    },
    setText(value: string) {
      if (!doc) {
        return;
      }

      setSnapshot({
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
): NotesStore {
  const existingStores = notesStoresByScope.get(domainScope);
  if (existingStores) {
    const existingStore = existingStores.get(noteId);
    if (existingStore) {
      return existingStore;
    }
  }

  const nextStore = createNotesStore(noteId, runtime);
  const stores = existingStores ?? new Map<string, NotesStore>();
  stores.set(noteId, nextStore);
  notesStoresByScope.set(domainScope, stores);
  return nextStore;
}

export function NotesProvider({ children }: PropsWithChildren) {
  const runtime = useAppData();
  const store = useMemo(
    () => getOrCreateNotesStore(runtime.domainScope, NOTE_ID, runtime),
    [runtime.domainScope],
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
      ready: snapshot.ready,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
