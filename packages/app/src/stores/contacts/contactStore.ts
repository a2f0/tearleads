import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import { isDocumentUpdateCreatedEvent } from "../../data/documentSync";
import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import {
  type ContactDocumentState,
  type ContactsPersistence,
  defaultContactsPersistence,
  deleteContactEntry,
  loadStoredContactDocumentStates,
  persistImportedContactEntry,
  syncContactDocument,
} from "../../workflows/contacts";
import type { ContactsRuntime, ContactsSnapshot, ContactsStore } from "./types";

type ContactState = ContactDocumentState;

const ADDRESS_BOOK_ID = "default";
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
  resolveProjectionUserKey: ProjectionUserKeyResolver;
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
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      initialRuntime,
      "Contacts",
    ),
    runtime: initialRuntime,
    snapshot: {
      entries: [],
      ready: false,
    },
    syncLane: null,
    writeChain: Promise.resolve(),
  };
}

function didContactsProjectionResolverContextChange(
  previousRuntime: ContactsRuntime,
  nextRuntime: ContactsRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
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

  const storedContacts = await loadStoredContactDocumentStates({
    addressBookId: ADDRESS_BOOK_ID,
    execSql: state.runtime.execSql,
    persistence: state.persistence,
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

async function syncSingleContact(
  state: ContactsStoreState,
  contact: ContactState,
  targetSecretKey: Uint8Array,
) {
  const syncedContact = await syncContactDocument({
    addressBookId: ADDRESS_BOOK_ID,
    contact,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
    persistence: state.persistence,
    targetSecretKey,
  });
  if (!syncedContact) {
    return;
  }

  contact.entry = syncedContact.entry;
  contact.record = syncedContact.record;
  setContactsSnapshot(state, {
    entries: getSnapshotEntries(state.contactsByUserId),
    ready: true,
  });

  if (syncedContact.shouldRequestFollowupSync) {
    requestContactsSync(state);
  }
}

async function runContactsSyncIteration(state: ContactsStoreState) {
  if (
    !state.snapshot.ready ||
    !state.runtime.online ||
    !state.runtime.isAuthenticated ||
    !state.runtime.encapsulationKeyPair
  ) {
    return;
  }

  const encapsulationKeyPair = state.runtime.encapsulationKeyPair;
  if (!encapsulationKeyPair) {
    return;
  }

  for (const userId of Array.from(state.contactsByUserId.keys())) {
    const contact = state.contactsByUserId.get(userId);
    if (!contact) {
      continue;
    }

    await syncSingleContact(state, contact, encapsulationKeyPair.secretKey);
  }
}

function scheduleContactsSync(state: ContactsStoreState) {
  requestContactsSync(state);
}

function handleContactsRemoteEvents(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  const knownDocumentIds = new Set<string>();
  for (const contact of state.contactsByUserId.values()) {
    if (typeof contact.record.documentId === "string") {
      knownDocumentIds.add(contact.record.documentId);
    }
  }

  if (knownDocumentIds.size === 0) {
    state.lastEventCount = state.runtime.events.length;
    return;
  }

  const nextEvents = state.runtime.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.events.length;
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

async function importContactEntry(
  state: ContactsStoreState,
  entry: AddressBookEntry,
  scheduleSync: () => void,
) {
  const existingContact = state.contactsByUserId.get(entry.userId);

  if (
    existingContact &&
    existingContact.entry.encapsulationPublicKey ===
      entry.encapsulationPublicKey
  ) {
    return;
  }

  const imported = await persistImportedContactEntry({
    addressBookId: ADDRESS_BOOK_ID,
    entry,
    execSql: state.runtime.execSql,
    existingContact,
    persistence: state.persistence,
  });
  if (!imported.changed) {
    return;
  }

  state.contactsByUserId.set(entry.userId, imported.contact);
  setContactsSnapshot(state, {
    entries: getSnapshotEntries(state.contactsByUserId),
    ready: true,
  });
  scheduleSync();
  state.runtime.log("Peer key imported");
}

async function importKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
  scheduleSync: () => void,
) {
  state.runtime.log(`Importing peer key for userId: ${userId}`);
  const response = await state.runtime.apiClient.getEncapsulationKey(userId);
  if (!response) {
    return;
  }

  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  const entry: AddressBookEntry = {
    userId: response.userId,
    encapsulationPublicKey: response.encapsulationPublicKey,
    isSelf: false,
  };

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(() => importContactEntry(state, entry, scheduleSync))
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
      await deleteContactEntry({
        addressBookId: ADDRESS_BOOK_ID,
        execSql: state.runtime.execSql,
        persistence: state.persistence,
        userId,
      });
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsByUserId),
        ready: true,
      });
      state.runtime.log("Peer key removed");
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
  if (
    didContactsProjectionResolverContextChange(previousRuntime, nextRuntime)
  ) {
    state.resolveProjectionUserKey = createProjectionUserKeyResolver(
      nextRuntime,
      "Contacts",
    );
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
