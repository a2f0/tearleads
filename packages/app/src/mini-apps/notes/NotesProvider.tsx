import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createTextDocument,
  decryptLoroUpdate,
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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApiClient } from "../../api/ApiClientProvider";
import { useNetworkState } from "../../api/NetworkStateProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import { useLog } from "../../logging/LogProvider";

type NotesDocument = Awaited<ReturnType<typeof createTextDocument>>;

interface NoteRecord {
  id: string;
  documentId: string | null;
  text: string;
  loroSnapshot: string;
  remoteCursor: number | null;
}

interface PendingUpdateRecord {
  id: string;
  updateData: string;
}

interface NotesContextValue {
  ready: boolean;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface DocumentUpdateCreatedEvent {
  type: "document_update_created";
  documentId: string;
}

const NOTE_ID = "default";
const DEVICE_SEED_KEY = "tearleads.notes.device-seed";

const notesSql = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    text TEXT NOT NULL,
    loro_snapshot TEXT NOT NULL,
    remote_cursor INTEGER,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS note_pending_updates (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    update_data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const NotesContext = createContext<NotesContextValue | null>(null);

function getDeviceSeed(): string {
  const existing = window.localStorage.getItem(DEVICE_SEED_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_SEED_KEY, created);
  return created;
}

function readRowValue(
  row: Record<string, string | number | null>,
  key: string,
): string | number | null | undefined {
  return row[key];
}

function parseNoteRecord(
  value: Record<string, string | number | null>,
): NoteRecord {
  const id = readRowValue(value, "id");
  const documentId = readRowValue(value, "document_id");
  const text = readRowValue(value, "text");
  const loroSnapshot = readRowValue(value, "loro_snapshot");
  const remoteCursor = readRowValue(value, "remote_cursor");

  return {
    id: String(id ?? NOTE_ID),
    documentId: documentId === null ? null : String(documentId),
    text: String(text ?? ""),
    loroSnapshot: String(loroSnapshot ?? ""),
    remoteCursor: typeof remoteCursor === "number" ? remoteCursor : null,
  };
}

function parsePendingUpdateRecord(
  value: Record<string, string | number | null>,
): PendingUpdateRecord {
  const id = readRowValue(value, "id");
  const updateData = readRowValue(value, "update_data");

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
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

export function NotesProvider({ children }: PropsWithChildren) {
  const apiClient = useApiClient();
  const { online } = useNetworkState();
  const { client: dbClient, status: dbStatus } = useDatabase();
  const { encapsulationKeyPair, isAuthenticated } = useCryptoSession();
  const { events } = useEvents();
  const { log } = useLog();
  const [ready, setReady] = useState(false);
  const [text, setEditorText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const docRef = useRef<NotesDocument | null>(null);
  const recordRef = useRef<NoteRecord | null>(null);
  const writeChainRef = useRef(Promise.resolve());
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const syncRequestedRef = useRef(false);
  const activeRef = useRef(true);

  const execSql = useCallback(
    async (sql: string, bind?: Record<string, string | number | null>) => {
      if (!dbClient) {
        throw new Error("Database client is unavailable.");
      }

      const result = await dbClient.exec(bind ? { sql, bind } : { sql });
      return result.rows;
    },
    [dbClient],
  );

  const ensureSchema = useCallback(async () => {
    await execSql(notesSql);
  }, [execSql]);

  const saveNoteRecord = useCallback(
    async (record: NoteRecord) => {
      await execSql(
        `
          INSERT INTO notes (
            id,
            document_id,
            text,
            loro_snapshot,
            remote_cursor,
            updated_at
          )
          VALUES (
            :id,
            :documentId,
            :text,
            :loroSnapshot,
            :remoteCursor,
            :updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            document_id = excluded.document_id,
            text = excluded.text,
            loro_snapshot = excluded.loro_snapshot,
            remote_cursor = excluded.remote_cursor,
            updated_at = excluded.updated_at
        `,
        {
          ":id": record.id,
          ":documentId": record.documentId,
          ":text": record.text,
          ":loroSnapshot": record.loroSnapshot,
          ":remoteCursor": record.remoteCursor,
          ":updatedAt": new Date().toISOString(),
        },
      );
      recordRef.current = record;
    },
    [execSql],
  );

  const persistDocument = useCallback(
    async (doc: NotesDocument, patch: Partial<NoteRecord> = {}) => {
      const current = recordRef.current;
      const record: NoteRecord = {
        id: current?.id ?? NOTE_ID,
        documentId: patch.documentId ?? current?.documentId ?? null,
        text: patch.text ?? getTextValue(doc),
        loroSnapshot:
          patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(doc)),
        remoteCursor: patch.remoteCursor ?? current?.remoteCursor ?? null,
      };
      await saveNoteRecord(record);
      return record;
    },
    [saveNoteRecord],
  );

  const listPendingUpdates = useCallback(async (): Promise<
    PendingUpdateRecord[]
  > => {
    const rows = await execSql(
      `
        SELECT id, update_data
        FROM note_pending_updates
        WHERE note_id = :noteId
        ORDER BY created_at ASC
      `,
      {
        ":noteId": NOTE_ID,
      },
    );

    return rows.map((row) => parsePendingUpdateRecord(row));
  }, [execSql]);

  const enqueuePendingUpdate = useCallback(
    async (update: Uint8Array) => {
      if (update.byteLength === 0) {
        return;
      }

      await execSql(
        `
          INSERT INTO note_pending_updates (
            id,
            note_id,
            update_data,
            created_at
          )
          VALUES (
            :id,
            :noteId,
            :updateData,
            :createdAt
          )
        `,
        {
          ":id": crypto.randomUUID(),
          ":noteId": NOTE_ID,
          ":updateData": bytesToBase64(update),
          ":createdAt": new Date().toISOString(),
        },
      );
    },
    [execSql],
  );

  const deletePendingUpdate = useCallback(
    async (id: string) => {
      await execSql(
        `
          DELETE FROM note_pending_updates
          WHERE id = :id
        `,
        {
          ":id": id,
        },
      );
    },
    [execSql],
  );

  const initialize = useCallback(async () => {
    if (!dbClient || dbStatus !== "ready") {
      return;
    }

    try {
      await ensureSchema();

      const rows = await execSql(
        `
          SELECT id, document_id, text, loro_snapshot, remote_cursor
          FROM notes
          WHERE id = :id
          LIMIT 1
        `,
        {
          ":id": NOTE_ID,
        },
      );

      if (!activeRef.current) {
        return;
      }

      const doc = await createTextDocument(getDeviceSeed());
      const existing = rows[0] ? parseNoteRecord(rows[0]) : null;

      if (existing?.loroSnapshot) {
        importUpdates(doc, [base64ToBytes(existing.loroSnapshot)]);
        recordRef.current = existing;
        setEditorText(getTextValue(doc));
      } else {
        const created: NoteRecord = {
          id: NOTE_ID,
          documentId: null,
          text: "",
          loroSnapshot: bytesToBase64(exportAllUpdates(doc)),
          remoteCursor: null,
        };
        await saveNoteRecord(created);
        setEditorText("");
      }

      if (!activeRef.current) {
        return;
      }

      docRef.current = doc;
      setReady(true);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    }
  }, [dbClient, dbStatus, ensureSchema, execSql, saveNoteRecord]);

  const scheduleSync = useCallback(() => {
    syncRequestedRef.current = true;

    if (syncPromiseRef.current) {
      return;
    }

    syncPromiseRef.current = (async () => {
      while (syncRequestedRef.current) {
        syncRequestedRef.current = false;

        if (
          !dbClient ||
          !docRef.current ||
          !ready ||
          !online ||
          !isAuthenticated ||
          !encapsulationKeyPair
        ) {
          continue;
        }

        setSyncing(true);

        try {
          let record = recordRef.current;

          if (!record) {
            continue;
          }

          const pendingUpdates = await listPendingUpdates();
          let documentId = record.documentId;

          if (documentId) {
            const fetched = await apiClient.getDocumentUpdates(
              documentId,
              record.remoteCursor ?? undefined,
            );

            if (fetched) {
              if (fetched.updates.length > 0) {
                const decrypted = await Promise.all(
                  fetched.updates.map((update) =>
                    decryptLoroUpdate(
                      update.encryptedData,
                      encapsulationKeyPair.secretKey,
                    ),
                  ),
                );
                importUpdates(docRef.current, decrypted);
                setEditorText(getTextValue(docRef.current));
              }

              record = await persistDocument(docRef.current, {
                documentId,
                remoteCursor: fetched.nextCursor,
              });
            }
          }

          if (!documentId && pendingUpdates.length > 0) {
            const created = await apiClient.createDocument();
            if (!created) {
              continue;
            }

            documentId = created.id;
            record = await persistDocument(docRef.current, {
              documentId,
            });
            log(`Created notes document: ${created.id}`);
          }

          for (const pending of pendingUpdates) {
            if (!documentId) {
              break;
            }

            const encrypted = await encryptLoroUpdate(
              base64ToBytes(pending.updateData),
              [encapsulationKeyPair.publicKey],
            );
            const appended = await apiClient.appendDocumentUpdate(
              documentId,
              encrypted,
            );

            if (!appended) {
              break;
            }

            await deletePendingUpdate(pending.id);
            record = await persistDocument(docRef.current, {
              documentId,
              remoteCursor: appended.sequence,
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
          setSyncing(false);
        }
      }

      syncPromiseRef.current = null;
    })();
  }, [
    apiClient,
    dbClient,
    deletePendingUpdate,
    encapsulationKeyPair,
    isAuthenticated,
    listPendingUpdates,
    log,
    online,
    persistDocument,
    ready,
  ]);

  useEffect(() => {
    activeRef.current = true;
    setReady(false);
    docRef.current = null;
    recordRef.current = null;

    void initialize();

    return () => {
      activeRef.current = false;
    };
  }, [initialize]);

  useEffect(() => {
    if (ready) {
      scheduleSync();
    }
  }, [ready, scheduleSync]);

  useEffect(() => {
    if (online && ready) {
      scheduleSync();
    }
  }, [online, ready, scheduleSync]);

  useEffect(() => {
    const documentId = recordRef.current?.documentId;
    if (!documentId || !ready) {
      return;
    }

    if (
      events.some(
        (event) =>
          isDocumentUpdateCreatedEvent(event) &&
          event.documentId === documentId,
      )
    ) {
      scheduleSync();
    }
  }, [events, ready, scheduleSync]);

  const setText = useCallback(
    (value: string) => {
      setEditorText(value);

      writeChainRef.current = writeChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const doc = docRef.current;
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
        .catch((error) => {
          console.error("Failed to persist note changes:", error);
        });
    },
    [enqueuePendingUpdate, persistDocument, scheduleSync],
  );

  const value = useMemo(
    () => ({
      ready,
      text,
      syncing,
      setText,
    }),
    [ready, setText, syncing, text],
  );

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
  );
}

export function useNotes(): NotesContextValue {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error("useNotes must be used within a NotesProvider.");
  }

  return context;
}
