import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import {
  type ContactDocumentState,
  type ContactProjectionUserKeyResolver,
  type ContactsPersistence,
  createContactProjectionUserKeyResolver,
  DEFAULT_CONTACTS_ADDRESS_BOOK_ID,
  defaultContactsPersistence,
  didContactProjectionKeyRuntimeChange,
  fetchContactKeyEntryFromRuntime,
  hasContactDocumentUpdateEvent,
  loadContactDocumentStates,
  persistContactKeyEntryFromRuntime,
  removeContactKeyFromRuntime,
  syncContactDocuments,
} from "../../workflows/contacts";
import type { ContactsRuntime, ContactsSnapshot, ContactsStore } from "./types";

type ContactState = ContactDocumentState;

const contactsStoresByScope = new WeakMap<object, ContactsStore>();

function sortEntries(
  entries: ReadonlyArray<AddressBookEntry>,
): AddressBookEntry[] {
  return [...entries].sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );
}

function getSnapshotEntries(
  contactsByUserId: ReadonlyMap<string, ContactState>,
): AddressBookEntry[] {
  return sortEntries(
    Array.from(contactsByUserId.values(), (contact) => contact.entry),
  );
}

interface ContactsStoreState {
  contactsByUserId: Map<string, ContactState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  persistence: ContactsPersistence;
  resolveProjectionUserKey: ContactProjectionUserKeyResolver;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  syncLane: SyncLane | null;
  writeChain: Promise<void>;
}

function createContactsStoreState(
  initialRuntime: ContactsRuntime,
  persistence: ContactsPersistence,
): ContactsStoreState {
  return {
    contactsByUserId: new Map(),
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    listeners: new Set(),
    persistence,
    resolveProjectionUserKey:
      createContactProjectionUserKeyResolver(initialRuntime),
    runtime: initialRuntime,
    snapshot: {
      entries: [],
      ready: false,
    },
    syncLane: null,
    writeChain: Promise.resolve(),
  };
}

function emitContactsStore(state: ContactsStoreState) {
  for (const listener of state.listeners) {
    listener();
  }
}

function setContactsSnapshot(
  state: ContactsStoreState,
  next: ContactsSnapshot,
) {
  if (
    state.snapshot.ready === next.ready &&
    state.snapshot.entries.length === next.entries.length &&
    state.snapshot.entries.every((entry, index) => {
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

  state.snapshot = next;
  emitContactsStore(state);
}

function resetContactsStore(state: ContactsStoreState) {
  state.contactsByUserId = new Map();
  state.initialized = false;
  state.initializePromise = null;
  state.writeChain = Promise.resolve();
  setContactsSnapshot(state, {
    entries: [],
    ready: false,
  });
}

function requestContactsSync(state: ContactsStoreState) {
  state.syncLane?.requestSync();
}

async function initializeContactsStore(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  const storedContacts = await loadContactDocumentStates({
    persistence: state.persistence,
    runtime: state.runtime,
  });

  for (const storedContact of storedContacts) {
    state.contactsByUserId.set(storedContact.entry.userId, storedContact);
  }

  state.initialized = true;
  state.initializePromise = null;
  setContactsSnapshot(state, {
    entries: getSnapshotEntries(state.contactsByUserId),
    ready: true,
  });
  if (state.contactsByUserId.size > 0) {
    scheduleSync();
  }
}

function ensureContactsInitialized(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeContactsStore(state, scheduleSync).catch(
    (error: unknown) => {
      state.initializePromise = null;
      if (isDestroyedDatabaseClientError(error)) {
        return;
      }
      throw error;
    },
  );
}

async function waitForContactsInitialization(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  ensureContactsInitialized(state, scheduleSync);
  if (state.initializePromise) {
    await state.initializePromise;
  }
}

async function runContactsSyncIteration(state: ContactsStoreState) {
  const result = await syncContactDocuments({
    addressBookId: DEFAULT_CONTACTS_ADDRESS_BOOK_ID,
    contacts: Array.from(state.contactsByUserId.values()),
    persistence: state.persistence,
    ready: state.snapshot.ready,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });
  if (result.syncedContactCount > 0) {
    setContactsSnapshot(state, {
      entries: getSnapshotEntries(state.contactsByUserId),
      ready: true,
    });
  }

  if (result.shouldRequestFollowupSync) {
    requestContactsSync(state);
  }
}

function scheduleContactsSync(state: ContactsStoreState) {
  requestContactsSync(state);
}

function handleContactsRemoteEvents(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  const nextEvents = state.runtime.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.events.length;
  if (
    hasContactDocumentUpdateEvent(nextEvents, state.contactsByUserId.values())
  ) {
    scheduleSync();
  }
}

async function importKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
  scheduleSync: () => void,
) {
  const entry = await fetchContactKeyEntryFromRuntime({
    runtime: state.runtime,
    userId,
  });
  if (!entry) {
    return;
  }

  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const existingContact = state.contactsByUserId.get(entry.userId);
      const imported = await persistContactKeyEntryFromRuntime({
        entry,
        existingContact,
        persistence: state.persistence,
        runtime: state.runtime,
      });
      if (!imported.changed) {
        return;
      }

      state.contactsByUserId.set(
        imported.contact.entry.userId,
        imported.contact,
      );
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsByUserId),
        ready: true,
      });
      scheduleSync();
    })
    .catch((error: unknown) => {
      state.runtime.logError("Failed to persist contact", error);
    });
  await state.writeChain;
}

async function removeKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
  scheduleSync: () => void,
) {
  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.contactsByUserId.has(userId)) {
        return;
      }

      state.contactsByUserId.delete(userId);
      await removeContactKeyFromRuntime({
        persistence: state.persistence,
        runtime: state.runtime,
        userId,
      });
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsByUserId),
        ready: true,
      });
    })
    .catch((error: unknown) => {
      state.runtime.logError("Failed to remove contact", error);
    });
  await state.writeChain;
}

function updateContactsStoreRuntime(
  state: ContactsStoreState,
  nextRuntime: ContactsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  if (didContactProjectionKeyRuntimeChange(previousRuntime, nextRuntime)) {
    state.resolveProjectionUserKey =
      createContactProjectionUserKeyResolver(nextRuntime);
  }
  state.runtime = nextRuntime;

  if (nextRuntime.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetContactsStore(state);
    }
    state.lastEventCount = nextRuntime.events.length;
    return;
  }

  ensureContactsInitialized(state, scheduleSync);

  handleContactsRemoteEvents(state, scheduleSync);

  if (
    state.snapshot.ready &&
    didRegainSyncPrerequisites(previousRuntime, nextRuntime)
  ) {
    scheduleSync();
  }
}

function subscribeToContactsStore(
  state: ContactsStoreState,
  listener: () => void,
) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function createContactsStore(
  initialRuntime: ContactsRuntime,
  persistence: ContactsPersistence = defaultContactsPersistence,
): ContactsStore {
  const state = createContactsStoreState(initialRuntime, persistence);
  state.syncLane = getOrCreateDomainSyncCoordinator(
    initialRuntime.domainScope,
  ).registerLane("contacts", {
    run: () => runContactsSyncIteration(state),
    shouldIgnoreError: isDestroyedDatabaseClientError,
  });
  const scheduleSync = () => scheduleContactsSync(state);

  return {
    getSnapshot: () => state.snapshot,
    importKey: (userId: string) =>
      importKeyFromRuntime(state, userId, scheduleSync),
    removeKey: (userId: string) =>
      removeKeyFromRuntime(state, userId, scheduleSync),
    subscribe: (listener: () => void) =>
      subscribeToContactsStore(state, listener),
    updateRuntime: (runtime: ContactsRuntime) =>
      updateContactsStoreRuntime(state, runtime, scheduleSync),
  };
}

export function getOrCreateContactsStore(
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
