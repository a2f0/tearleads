import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decryptLoroUpdate,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
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
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/documentPersistence";
import {
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../data/documentSync";
import type { ExecSql } from "../../data/sqlSchema";
import {
  type ContactsPersistence,
  sqlContactsPersistence,
} from "./contactsPersistence";
import type { AddressBookEntry } from "./types";

type ContactsDocument = Awaited<ReturnType<typeof createDocument>>;
type ContactsAppData = ReturnType<typeof useAppData>;

interface ContactsContextValue {
  entries: ReadonlyArray<AddressBookEntry>;
  importKey: (userId: string) => Promise<void>;
  ready: boolean;
  removeKey: (userId: string) => Promise<void>;
}

interface ContactsSnapshot {
  entries: ReadonlyArray<AddressBookEntry>;
  ready: boolean;
}

export interface ContactsRuntime {
  apiClient: Pick<
    ContactsAppData["apiClient"],
    "createDocument" | "getEncapsulationKey" | "syncDocument"
  >;
  dbStatus: ContactsAppData["dbStatus"];
  domainScope: ContactsAppData["domainScope"];
  encapsulationKeyPair: ContactsAppData["encapsulationKeyPair"];
  events: ContactsAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ContactsAppData["isAuthenticated"];
  log: ContactsAppData["log"];
  online: ContactsAppData["online"];
}

interface ContactsStore {
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

const ADDRESS_BOOK_ID = "default";
const contactsStoresByScope = new WeakMap<object, ContactsStore>();
const ContactsContext = createContext<ContactsStore | null>(null);

function sortEntries(
  entries: ReadonlyArray<AddressBookEntry>,
): AddressBookEntry[] {
  return [...entries].sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );
}

function getEntriesValue(doc: ContactsDocument): AddressBookEntry[] {
  const rawEntries = Array.from(doc.getMap("entries").entries());

  return sortEntries(
    rawEntries.flatMap(([userId, value]) =>
      typeof value === "string"
        ? [
            {
              userId,
              encapsulationPublicKey: value,
            },
          ]
        : [],
    ),
  );
}

function setEntryValue(doc: ContactsDocument, entry: AddressBookEntry) {
  doc.getMap("entries").set(entry.userId, entry.encapsulationPublicKey);
}

export function createContactsStore(
  initialRuntime: ContactsRuntime,
  persistence: ContactsPersistence = sqlContactsPersistence,
): ContactsStore {
  let runtime = initialRuntime;
  let snapshot: ContactsSnapshot = {
    entries: [],
    ready: false,
  };
  let doc: ContactsDocument | null = null;
  let record: DocumentRecord | null = null;
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

  function setSnapshot(next: ContactsSnapshot) {
    if (
      snapshot.ready === next.ready &&
      snapshot.entries.length === next.entries.length &&
      snapshot.entries.every((entry, index) => {
        const nextEntry = next.entries[index];
        return (
          nextEntry &&
          entry.userId === nextEntry.userId &&
          entry.encapsulationPublicKey === nextEntry.encapsulationPublicKey
        );
      })
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
      entries: [],
      ready: false,
    });
  }

  async function saveAddressBookRecord(
    nextRecord: DocumentRecord,
    currentDoc: ContactsDocument,
  ) {
    await persistence.saveAddressBook(
      runtime.execSql,
      nextRecord,
      getEntriesValue(currentDoc),
    );
    record = nextRecord;
  }

  async function persistDocument(
    currentDoc: ContactsDocument,
    patch: Partial<DocumentRecord> = {},
  ): Promise<DocumentRecord> {
    const nextRecord: DocumentRecord = {
      id: record?.id ?? ADDRESS_BOOK_ID,
      documentId: patch.documentId ?? record?.documentId ?? null,
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
      accessEpoch: patch.accessEpoch ?? record?.accessEpoch ?? 1,
    };

    await saveAddressBookRecord(nextRecord, currentDoc);
    setSnapshot({
      entries: getEntriesValue(currentDoc),
      ready: true,
    });
    return nextRecord;
  }

  async function listPendingUpdates(): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, ADDRESS_BOOK_ID);
  }

  async function enqueuePendingUpdate(update: Uint8Array) {
    const pendingUpdateFields = createPendingUpdateFields(update);
    if (!pendingUpdateFields) {
      return;
    }

    await persistence.enqueuePendingUpdate(runtime.execSql, {
      addressBookId: ADDRESS_BOOK_ID,
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
    const stored = await persistence.loadAddressBook(
      runtime.execSql,
      ADDRESS_BOOK_ID,
    );
    const nextDoc = await createDocument(getScopedPeerSeed("contacts"));

    if (stored.record?.loroSnapshot) {
      importUpdates(nextDoc, [base64ToBytes(stored.record.loroSnapshot)]);
      record = stored.record;
      setSnapshot({
        entries: getEntriesValue(nextDoc),
        ready: true,
      });
    } else {
      for (const entry of stored.entries) {
        setEntryValue(nextDoc, entry);
      }

      if (stored.entries.length > 0) {
        await enqueuePendingUpdate(exportAllUpdates(nextDoc));
      }

      const created: DocumentRecord = {
        id: ADDRESS_BOOK_ID,
        documentId: null,
        loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
        accessEpoch: 1,
      };
      await saveAddressBookRecord(created, nextDoc);
      setSnapshot({
        entries: getEntriesValue(nextDoc),
        ready: true,
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

  async function waitForInitialization() {
    ensureInitialized();

    if (initializePromise) {
      await initializePromise;
    }
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
            runtime.log(`Created contacts document: ${created.id}`);
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
                entries: getEntriesValue(doc),
                ready: true,
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
    async importKey(userId: string) {
      runtime.log(`Importing peer key for userId: ${userId}`);
      const response = await runtime.apiClient.getEncapsulationKey(userId);
      if (!response) {
        return;
      }

      await waitForInitialization();
      if (!doc || runtime.dbStatus !== "ready") {
        return;
      }

      const entry: AddressBookEntry = {
        userId: response.userId,
        encapsulationPublicKey: response.encapsulationPublicKey,
      };

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          if (!doc) {
            return;
          }

          if (
            doc.getMap("entries").get(entry.userId) ===
            entry.encapsulationPublicKey
          ) {
            return;
          }

          const previousVersion = encodeVersionVector(doc);
          setEntryValue(doc, entry);
          const update = exportUpdatesSince(doc, previousVersion);

          await enqueuePendingUpdate(update);
          await persistDocument(doc);
          scheduleSync();
          runtime.log("Peer key imported");
        })
        .catch((error: unknown) => {
          console.error("Failed to persist contact:", error);
        });

      await writeChain;
    },
    async removeKey(userId: string) {
      await waitForInitialization();
      if (!doc || runtime.dbStatus !== "ready") {
        return;
      }

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          if (!doc) {
            return;
          }

          if (typeof doc.getMap("entries").get(userId) === "undefined") {
            return;
          }

          const previousVersion = encodeVersionVector(doc);
          doc.getMap("entries").delete(userId);
          const update = exportUpdatesSince(doc, previousVersion);

          await enqueuePendingUpdate(update);
          await persistDocument(doc);
          scheduleSync();
        })
        .catch((error: unknown) => {
          console.error("Failed to remove contact:", error);
        });

      await writeChain;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    updateRuntime(nextRuntime: ContactsRuntime) {
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

function getOrCreateContactsStore(
  domainScope: object,
  runtime: ContactsRuntime,
): ContactsStore {
  const existingStore = contactsStoresByScope.get(domainScope);
  if (existingStore) {
    return existingStore;
  }

  const nextStore = createContactsStore(runtime);
  contactsStoresByScope.set(domainScope, nextStore);
  return nextStore;
}

export function ContactsProvider({ children }: PropsWithChildren) {
  const runtime = useAppData();
  const store = useMemo(
    () => getOrCreateContactsStore(runtime.domainScope, runtime),
    [runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <ContactsContext.Provider value={store}>
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts(): ContactsContextValue {
  const store = useContext(ContactsContext);
  if (!store) {
    throw new Error("useContacts must be used within a ContactsProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      entries: snapshot.entries,
      importKey: store.importKey,
      ready: snapshot.ready,
      removeKey: store.removeKey,
    }),
    [snapshot, store],
  );
}
