import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
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
  decryptIncomingUpdates,
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

interface ContactState {
  doc: ContactsDocument;
  entry: AddressBookEntry;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord;
}

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
  containerId: ContactsAppData["containerId"];
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

function getEntryValue(
  userId: string,
  doc: ContactsDocument,
  isSelf = false,
): AddressBookEntry | null {
  const encapsulationPublicKey = doc
    .getMap("contact")
    .get("encapsulationPublicKey");

  return typeof encapsulationPublicKey === "string"
    ? {
        userId,
        encapsulationPublicKey,
        isSelf,
      }
    : null;
}

function setEntryValue(doc: ContactsDocument, entry: AddressBookEntry) {
  const map = doc.getMap("contact");
  map.set("userId", entry.userId);
  map.set("encapsulationPublicKey", entry.encapsulationPublicKey);
}

function getSnapshotEntries(
  contactsByUserId: ReadonlyMap<string, ContactState>,
): AddressBookEntry[] {
  return sortEntries(
    Array.from(contactsByUserId.values(), (contact) => contact.entry),
  );
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
  let contactsByUserId = new Map<string, ContactState>();
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

  function resetStore() {
    contactsByUserId = new Map();
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve();
    setSnapshot({
      entries: [],
      ready: false,
    });
  }

  async function createContactDocument() {
    return createDocument(getScopedPeerSeed("contacts"));
  }

  async function persistContact(
    contact: ContactState,
    patch: Partial<DocumentRecord> = {},
  ): Promise<DocumentRecord> {
    const nextRecord: DocumentRecord = {
      id: contact.entry.userId,
      documentId: patch.documentId ?? contact.record.documentId ?? null,
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(contact.doc)),
      accessEpoch: patch.accessEpoch ?? contact.record.accessEpoch ?? 1,
    };

    await persistence.saveContact(
      runtime.execSql,
      ADDRESS_BOOK_ID,
      nextRecord,
      contact.entry,
    );
    contact.record = nextRecord;
    setSnapshot({
      entries: getSnapshotEntries(contactsByUserId),
      ready: true,
    });
    return nextRecord;
  }

  async function listPendingUpdates(
    userId: string,
  ): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, userId);
  }

  async function enqueuePendingUpdate(userId: string, update: Uint8Array) {
    const pendingUpdateFields = createPendingUpdateFields(update);
    if (!pendingUpdateFields) {
      return;
    }

    await persistence.enqueuePendingUpdate(runtime.execSql, {
      userId,
      ...pendingUpdateFields,
    });
  }

  async function deletePendingUpdate(id: string) {
    await persistence.deletePendingUpdate(runtime.execSql, id);
  }

  async function replacePendingUpdatesWithBaseline(contact: ContactState) {
    await persistence.deletePendingUpdates(
      runtime.execSql,
      contact.entry.userId,
    );
    await enqueuePendingUpdate(
      contact.entry.userId,
      exportAllUpdates(contact.doc),
    );
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);
    const storedContacts = await persistence.loadContacts(
      runtime.execSql,
      ADDRESS_BOOK_ID,
    );

    for (const storedContact of storedContacts) {
      const nextDoc = await createContactDocument();
      let entry = storedContact.entry;
      let record = storedContact.record;

      if (record?.loroSnapshot) {
        importUpdates(nextDoc, [base64ToBytes(record.loroSnapshot)]);
        const docEntry = getEntryValue(entry.userId, nextDoc, entry.isSelf);
        if (docEntry) {
          entry = docEntry;
        }
      } else {
        setEntryValue(nextDoc, entry);
        const initialUpdate = exportAllUpdates(nextDoc);
        await enqueuePendingUpdate(entry.userId, initialUpdate);
        record = {
          id: entry.userId,
          documentId: null,
          loroSnapshot: bytesToBase64(initialUpdate),
          accessEpoch: 1,
        };
        await persistence.saveContact(
          runtime.execSql,
          ADDRESS_BOOK_ID,
          record,
          entry,
        );
      }

      contactsByUserId.set(entry.userId, {
        doc: nextDoc,
        entry,
        recipientPublicKeys: getLocalRecipientPublicKeys(
          runtime.encapsulationKeyPair,
        ),
        record,
      });
    }

    initialized = true;
    initializePromise = null;
    setSnapshot({
      entries: getSnapshotEntries(contactsByUserId),
      ready: true,
    });
    if (contactsByUserId.size > 0) {
      scheduleSync();
    }
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
          !snapshot.ready ||
          !runtime.online ||
          !runtime.isAuthenticated ||
          !runtime.encapsulationKeyPair
        ) {
          continue;
        }

        try {
          const encapsulationKeyPair = runtime.encapsulationKeyPair;

          if (!encapsulationKeyPair) {
            continue;
          }

          for (const userId of Array.from(contactsByUserId.keys())) {
            const contact = contactsByUserId.get(userId);
            if (!contact) {
              continue;
            }

            const pendingUpdates = await listPendingUpdates(userId);
            let documentId = contact.record.documentId;

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

              contact.recipientPublicKeys = resolveRecipientPublicKeys(
                created.recipientEncapsulationPublicKeys,
                getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
              );
              documentId = created.id;
              await persistContact(contact, {
                documentId,
                accessEpoch: created.currentAccessEpoch,
              });
              runtime.log(
                `Created contact document: ${created.id} (${contact.entry.userId})`,
              );
            }

            if (!documentId) {
              continue;
            }

            const outgoingUpdates = await encryptPendingUpdates(
              pendingUpdates,
              contact.recipientPublicKeys,
            );

            const synced = await runtime.apiClient.syncDocument(
              documentId,
              contact.record.accessEpoch,
              encodeVersionVector(contact.doc),
              outgoingUpdates,
            );

            if (!synced) {
              continue;
            }

            contact.recipientPublicKeys = resolveRecipientPublicKeys(
              synced.recipientEncapsulationPublicKeys,
              getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
            );

            for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
              await deletePendingUpdate(acceptedOutgoingUpdateId);
            }

            if (synced.updates.length > 0) {
              const decrypted = await decryptIncomingUpdates(
                synced.updates,
                encapsulationKeyPair.secretKey,
                (message) =>
                  runtime.log(`Contacts (${contact.entry.userId}): ${message}`),
              );
              if (decrypted.length > 0) {
                importUpdates(contact.doc, decrypted);
                const updatedEntry = getEntryValue(
                  contact.entry.userId,
                  contact.doc,
                  contact.entry.isSelf,
                );
                if (updatedEntry) {
                  contact.entry = updatedEntry;
                }
              }
            }

            const previousAccessEpoch = contact.record.accessEpoch;
            await persistContact(contact, {
              documentId,
              accessEpoch: synced.currentAccessEpoch,
            });

            if (synced.currentAccessEpoch !== previousAccessEpoch) {
              await replacePendingUpdatesWithBaseline(contact);
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
    })().finally(() => {
      syncPromise = null;
    });
  }

  function handleRemoteEvents() {
    const knownDocumentIds = new Set<string>();
    for (const contact of contactsByUserId.values()) {
      if (typeof contact.record.documentId === "string") {
        knownDocumentIds.add(contact.record.documentId);
      }
    }

    if (knownDocumentIds.size === 0) {
      lastEventCount = runtime.events.length;
      return;
    }

    const nextEvents = runtime.events.slice(lastEventCount);
    lastEventCount = runtime.events.length;

    if (
      nextEvents.some(
        (event) =>
          isDocumentUpdateCreatedEvent(event) &&
          knownDocumentIds.has(event.documentId),
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
      if (runtime.dbStatus !== "ready") {
        return;
      }

      const entry: AddressBookEntry = {
        userId: response.userId,
        encapsulationPublicKey: response.encapsulationPublicKey,
        isSelf: false,
      };

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          const existingContact = contactsByUserId.get(entry.userId);

          if (
            existingContact &&
            existingContact.entry.encapsulationPublicKey ===
              entry.encapsulationPublicKey
          ) {
            return;
          }

          if (!existingContact) {
            const nextDoc = await createContactDocument();
            setEntryValue(nextDoc, entry);
            const initialUpdate = exportAllUpdates(nextDoc);
            const nextContact: ContactState = {
              doc: nextDoc,
              entry,
              recipientPublicKeys: getLocalRecipientPublicKeys(
                runtime.encapsulationKeyPair,
              ),
              record: {
                id: entry.userId,
                documentId: null,
                loroSnapshot: bytesToBase64(initialUpdate),
                accessEpoch: 1,
              },
            };

            await enqueuePendingUpdate(entry.userId, initialUpdate);
            contactsByUserId.set(entry.userId, nextContact);
            await persistContact(nextContact);
          } else {
            const previousVersion = encodeVersionVector(existingContact.doc);
            setEntryValue(existingContact.doc, entry);
            existingContact.entry = entry;
            const update = exportUpdatesSince(
              existingContact.doc,
              previousVersion,
            );

            await enqueuePendingUpdate(entry.userId, update);
            await persistContact(existingContact);
          }

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
      if (runtime.dbStatus !== "ready") {
        return;
      }

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          if (!contactsByUserId.has(userId)) {
            return;
          }

          contactsByUserId.delete(userId);
          await persistence.deleteContact(
            runtime.execSql,
            ADDRESS_BOOK_ID,
            userId,
          );
          setSnapshot({
            entries: getSnapshotEntries(contactsByUserId),
            ready: true,
          });
          runtime.log("Peer key removed");
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

      for (const contact of contactsByUserId.values()) {
        if (!contact.record.documentId) {
          contact.recipientPublicKeys = getLocalRecipientPublicKeys(
            runtime.encapsulationKeyPair,
          );
        }
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
