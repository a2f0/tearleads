import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createTextDocument,
  decryptLoroUpdate,
  encodeVersionVector,
  encryptLoroUpdate,
  exportAllUpdates,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
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
import { type SqlRow, useAppData } from "../../data/AppDataProvider";

type NotesDocument = Awaited<ReturnType<typeof createTextDocument>>;
type NotesRuntime = Pick<
  ReturnType<typeof useAppData>,
  | "apiClient"
  | "dbStatus"
  | "domainScope"
  | "encapsulationKeyPair"
  | "events"
  | "execSql"
  | "isAuthenticated"
  | "log"
  | "online"
>;

interface NoteRecord {
  id: string;
  documentId: string | null;
  text: string;
  loroSnapshot: string;
  accessEpoch: number;
}

interface PendingUpdateRecord {
  id: string;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
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

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
}

interface NotesStore {
  getSnapshot: () => NotesSnapshot;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: NotesRuntime) => void;
}

const NOTE_ID = "default";
const notesSql = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    text TEXT NOT NULL,
    loro_snapshot TEXT NOT NULL,
    access_epoch INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS note_pending_updates (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    update_data TEXT NOT NULL,
    partial_start_version_vector TEXT NOT NULL,
    partial_end_version_vector TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const notesStoresByScope = new WeakMap<object, Map<string, NotesStore>>();
const NotesContext = createContext<NotesStore | null>(null);

function getDeviceSeed(): string {
  return crypto.randomUUID();
}

function readRowValue(
  row: SqlRow,
  key: string,
): string | number | null | undefined {
  return row[key];
}

function parseNoteRecord(value: SqlRow): NoteRecord {
  const id = readRowValue(value, "id");
  const documentId = readRowValue(value, "document_id");
  const text = readRowValue(value, "text");
  const loroSnapshot = readRowValue(value, "loro_snapshot");
  const accessEpoch = readRowValue(value, "access_epoch");

  return {
    id: String(id ?? NOTE_ID),
    documentId: documentId === null ? null : String(documentId),
    text: String(text ?? ""),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
  };
}

function parsePendingUpdateRecord(value: SqlRow): PendingUpdateRecord {
  const id = readRowValue(value, "id");
  const updateData = readRowValue(value, "update_data");
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
    partialStartVersionVector: String(partialStartVersionVector ?? ""),
    partialEndVersionVector: String(partialEndVersionVector ?? ""),
  };
}

function isDocumentUpdateCreatedEvent(
  event: unknown,
): event is DocumentUpdateCreatedEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "document_update_created" &&
    "documentId" in event &&
    typeof event.documentId === "string"
  );
}

function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
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

  function resetStore() {
    doc = null;
    record = null;
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve();
    setSnapshot({
      ready: false,
      text: "",
      syncing: false,
    });
  }

  async function saveNoteRecord(nextRecord: NoteRecord) {
    await runtime.execSql(
      `
        INSERT INTO notes (
          id,
          document_id,
          text,
          loro_snapshot,
          access_epoch,
          updated_at
        )
        VALUES (
          :id,
          :documentId,
          :text,
          :loroSnapshot,
          :accessEpoch,
          :updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          document_id = excluded.document_id,
          text = excluded.text,
          loro_snapshot = excluded.loro_snapshot,
          access_epoch = excluded.access_epoch,
          updated_at = excluded.updated_at
      `,
      {
        ":id": nextRecord.id,
        ":documentId": nextRecord.documentId,
        ":text": nextRecord.text,
        ":loroSnapshot": nextRecord.loroSnapshot,
        ":accessEpoch": nextRecord.accessEpoch,
        ":updatedAt": new Date().toISOString(),
      },
    );

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
    const rows = await runtime.execSql(
      `
        SELECT id, update_data
          , partial_start_version_vector
          , partial_end_version_vector
        FROM note_pending_updates
        WHERE note_id = :noteId
        ORDER BY created_at ASC
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => parsePendingUpdateRecord(row));
  }

  async function enqueuePendingUpdate(update: Uint8Array) {
    if (update.byteLength === 0) {
      return;
    }

    const { partialEndVersionVector, partialStartVersionVector } =
      getUpdateVersionVectors(update);

    await runtime.execSql(
      `
        INSERT INTO note_pending_updates (
          id,
          note_id,
          update_data,
          partial_start_version_vector,
          partial_end_version_vector,
          created_at
        )
        VALUES (
          :id,
          :noteId,
          :updateData,
          :partialStartVersionVector,
          :partialEndVersionVector,
          :createdAt
        )
      `,
      {
        ":id": crypto.randomUUID(),
        ":noteId": noteId,
        ":updateData": bytesToBase64(update),
        ":partialStartVersionVector": partialStartVersionVector,
        ":partialEndVersionVector": partialEndVersionVector,
        ":createdAt": new Date().toISOString(),
      },
    );
  }

  async function deletePendingUpdate(id: string) {
    await runtime.execSql(
      `
        DELETE FROM note_pending_updates
        WHERE id = :id
      `,
      {
        ":id": id,
      },
    );
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await runtime.execSql(notesSql);
    const noteColumns = await runtime.execSql("PRAGMA table_info(notes)");
    const hasAccessEpoch = noteColumns.some(
      (row) => readRowValue(row, "name") === "access_epoch",
    );

    if (!hasAccessEpoch) {
      await runtime.execSql(
        "ALTER TABLE notes ADD COLUMN access_epoch INTEGER NOT NULL DEFAULT 1",
      );
    }

    const pendingUpdateColumns = await runtime.execSql(
      "PRAGMA table_info(note_pending_updates)",
    );
    const hasPartialStartVersionVector = pendingUpdateColumns.some(
      (row) => readRowValue(row, "name") === "partial_start_version_vector",
    );
    const hasPartialEndVersionVector = pendingUpdateColumns.some(
      (row) => readRowValue(row, "name") === "partial_end_version_vector",
    );

    if (!hasPartialStartVersionVector) {
      await runtime.execSql(
        "ALTER TABLE note_pending_updates ADD COLUMN partial_start_version_vector TEXT NOT NULL DEFAULT ''",
      );
    }

    if (!hasPartialEndVersionVector) {
      await runtime.execSql(
        "ALTER TABLE note_pending_updates ADD COLUMN partial_end_version_vector TEXT NOT NULL DEFAULT ''",
      );
    }

    const rows = await runtime.execSql(
      `
        SELECT id, document_id, text, loro_snapshot, access_epoch
        FROM notes
        WHERE id = :id
        LIMIT 1
      `,
      {
        ":id": noteId,
      },
    );

    const nextDoc = await createTextDocument(getDeviceSeed());
    const existing = rows[0] ? parseNoteRecord(rows[0]) : null;

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

            documentId = created.id;
            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: created.currentAccessEpoch,
            });
            runtime.log(`Created notes document: ${created.id}`);
          }

          if (documentId) {
            const outgoingUpdates = await Promise.all(
              pendingUpdates.map(async (pending) => {
                const updateBytes = base64ToBytes(pending.updateData);
                const versionVectors =
                  pending.partialStartVersionVector &&
                  pending.partialEndVersionVector
                    ? {
                        partialStartVersionVector:
                          pending.partialStartVersionVector,
                        partialEndVersionVector:
                          pending.partialEndVersionVector,
                      }
                    : getUpdateVersionVectors(updateBytes);

                return {
                  id: pending.id,
                  encryptedData: await encryptLoroUpdate(updateBytes, [
                    encapsulationKeyPair.publicKey,
                  ]),
                  partialStartVersionVector:
                    versionVectors.partialStartVersionVector,
                  partialEndVersionVector:
                    versionVectors.partialEndVersionVector,
                };
              }),
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

            nextRecord = await persistDocument(doc, {
              documentId,
              accessEpoch: synced.currentAccessEpoch,
            });
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
