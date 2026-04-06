import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
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
  decryptIncomingUpdates,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../data/documentSync";
import {
  deriveNoteTitle,
  type NoteRecord,
  type NoteSummary,
  type NotesPersistence,
  type PendingUpdateRecord,
  sqlNotesPersistence,
} from "./notesPersistence";

type NotesDocument = Awaited<ReturnType<typeof createDocument>>;
type NotesAppData = ReturnType<typeof useAppData>;
export const DEFAULT_NOTE_ID = "default";

export interface NotesRuntime {
  apiClient: Pick<NotesAppData["apiClient"], "createDocument" | "syncDocument">;
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

  async function replacePendingUpdatesWithBaseline(currentDoc: NotesDocument) {
    await persistence.deletePendingUpdates(runtime.execSql, noteId);
    await enqueuePendingUpdate(exportAllUpdates(currentDoc));
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);

    const nextDoc = await createDocument(getScopedPeerSeed("notes"));
    const existing = await persistence.loadNote(runtime.execSql, noteId);

    if (existing) {
      if (existing.loroSnapshot.length > 0) {
        importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
      }

      record = existing;
      setSnapshot({
        ready: true,
        text: getTextValue(nextDoc),
        syncing: false,
      });
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
            if (!runtime.containerId) {
              continue;
            }

            const created = await runtime.apiClient.createDocument([
              runtime.containerId,
            ]);
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
              const decrypted = await decryptIncomingUpdates(
                synced.updates,
                encapsulationKeyPair.secretKey,
                (message) => runtime.log(`Notes: ${message}`),
              );
              if (decrypted.length > 0) {
                importUpdates(doc, decrypted);
                setSnapshot({
                  ready: true,
                  text: getTextValue(doc),
                  syncing: true,
                });
              }
            }

            const previousAccessEpoch = nextRecord.accessEpoch;
            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: synced.currentAccessEpoch,
            });

            if (synced.currentAccessEpoch !== previousAccessEpoch) {
              await replacePendingUpdatesWithBaseline(doc);
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
    setPersistedNoteListener(listener) {
      persistedNoteListener = listener;
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
      ready: snapshot.ready,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
