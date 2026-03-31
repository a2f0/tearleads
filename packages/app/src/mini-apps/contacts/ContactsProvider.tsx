import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import {
  type ContactsPersistence,
  sqlContactsPersistence,
} from "./contactsPersistence";

export interface AddressBookEntry {
  userId: string;
  encapsulationPublicKey: string;
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

type ContactsAppData = ReturnType<typeof useAppData>;

export type ContactsExecSql = ContactsAppData["execSql"];

export interface ContactsRuntime {
  apiClient: Pick<ContactsAppData["apiClient"], "getEncapsulationKey">;
  dbStatus: ContactsAppData["dbStatus"];
  domainScope: ContactsAppData["domainScope"];
  execSql: ContactsExecSql;
  log: ContactsAppData["log"];
}

interface ContactsStore {
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

const contactsStoresByScope = new WeakMap<object, ContactsStore>();
const ContactsContext = createContext<ContactsStore | null>(null);

function sortEntries(
  entries: ReadonlyArray<AddressBookEntry>,
): AddressBookEntry[] {
  return [...entries].sort((left, right) =>
    left.userId.localeCompare(right.userId),
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
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let writeChain = Promise.resolve();
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
    initialized = false;
    initializePromise = null;
    writeChain = Promise.resolve();
    setSnapshot({
      entries: [],
      ready: false,
    });
  }

  async function loadEntries(): Promise<ReadonlyArray<AddressBookEntry>> {
    return persistence.listEntries(runtime.execSql);
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);
    const entries = await loadEntries();
    initialized = true;
    initializePromise = null;
    setSnapshot({
      entries,
      ready: true,
    });
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
      };

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          await persistence.saveEntry(runtime.execSql, entry);

          const nextEntries = sortEntries([
            ...snapshot.entries.filter(
              (currentEntry) => currentEntry.userId !== entry.userId,
            ),
            entry,
          ]);

          setSnapshot({
            entries: nextEntries,
            ready: true,
          });
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
          await persistence.removeEntry(runtime.execSql, userId);

          setSnapshot({
            entries: snapshot.entries.filter(
              (entry) => entry.userId !== userId,
            ),
            ready: true,
          });
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
      runtime = nextRuntime;

      if (nextRuntime.dbStatus !== "ready") {
        if (snapshot.ready || initialized || initializePromise) {
          resetStore();
        }
        return;
      }

      ensureInitialized();
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
