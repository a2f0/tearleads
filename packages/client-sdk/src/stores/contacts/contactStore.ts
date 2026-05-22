import type { DomainScope } from "../../data/domainScope";
import {
  type ContactDocumentState,
  type ContactEntry,
  type ContactEntryPatch,
  type ContactProjectionUserKeyResolver,
  type ContactSyncLane,
  type ContactsPersistence,
  DEFAULT_CONTACTS_ADDRESS_BOOK_ID,
  defaultContactsPersistence,
  getContactDisplayName,
  hasContactDocumentUpdateEvent,
  isDestroyedContactSyncRuntimeError,
  registerContactSyncLane,
} from "../../workflows/contacts";
import type { ContactsRuntime, ContactsSnapshot, ContactsStore } from "./types";

type ContactState = ContactDocumentState;

const contactsStoresByScope = new WeakMap<DomainScope, ContactsStore>();

function sortEntries(entries: ReadonlyArray<ContactEntry>): ContactEntry[] {
  return [...entries].sort((left, right) => {
    const leftName = getContactDisplayName(left);
    const rightName = getContactDisplayName(right);
    return (
      leftName.localeCompare(rightName) ||
      (left.userId ?? "").localeCompare(right.userId ?? "") ||
      left.id.localeCompare(right.id)
    );
  });
}

function getSnapshotEntries(
  contactsById: ReadonlyMap<string, ContactState>,
): ContactEntry[] {
  return sortEntries(
    Array.from(contactsById.values(), (contact) => contact.entry),
  );
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function createContactEntryFromPatch(patch: ContactEntryPatch): ContactEntry {
  return {
    id: crypto.randomUUID(),
    firstName: patch.firstName?.trim() ?? "",
    lastName: patch.lastName?.trim() ?? "",
    userId: normalizeOptionalString(patch.userId),
    encapsulationPublicKey: normalizeOptionalString(
      patch.encapsulationPublicKey,
    ),
    isSelf: patch.isSelf ?? false,
  };
}

function patchContactEntry(
  entry: ContactEntry,
  patch: ContactEntryPatch,
): ContactEntry {
  return {
    id: entry.id,
    firstName:
      patch.firstName === undefined ? entry.firstName : patch.firstName.trim(),
    lastName:
      patch.lastName === undefined ? entry.lastName : patch.lastName.trim(),
    userId:
      patch.userId === undefined
        ? entry.userId
        : normalizeOptionalString(patch.userId),
    encapsulationPublicKey:
      patch.encapsulationPublicKey === undefined
        ? entry.encapsulationPublicKey
        : normalizeOptionalString(patch.encapsulationPublicKey),
    isSelf: patch.isSelf ?? entry.isSelf,
  };
}

function findContactByUserId(
  contactsById: ReadonlyMap<string, ContactState>,
  userId: string | null,
): ContactState | null {
  if (!userId) {
    return null;
  }

  for (const contact of contactsById.values()) {
    if (contact.entry.userId === userId) {
      return contact;
    }
  }

  return null;
}

function sameContactEntry(left: ContactEntry, right: ContactEntry): boolean {
  return (
    left.id === right.id &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.userId === right.userId &&
    left.encapsulationPublicKey === right.encapsulationPublicKey &&
    left.isSelf === right.isSelf
  );
}

interface ContactsStoreState {
  contactsById: Map<string, ContactState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  persistence: ContactsPersistence;
  resolveProjectionUserKey: ContactProjectionUserKeyResolver;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  syncLane: ContactSyncLane | null;
  writeChain: Promise<void>;
}

function createContactsStoreState(
  initialRuntime: ContactsRuntime,
  persistence: ContactsPersistence,
): ContactsStoreState {
  return {
    contactsById: new Map(),
    initializePromise: null,
    initialized: false,
    lastEventCount: 0,
    listeners: new Set(),
    persistence,
    resolveProjectionUserKey: initialRuntime.createProjectionUserKeyResolver(),
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
      return nextEntry && sameContactEntry(entry, nextEntry);
    })
  ) {
    return;
  }

  state.snapshot = next;
  emitContactsStore(state);
}

function resetContactsStore(state: ContactsStoreState) {
  state.contactsById = new Map();
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

  const storedContacts = await state.runtime.loadDocumentStates({
    persistence: state.persistence,
  });

  for (const storedContact of storedContacts) {
    state.contactsById.set(storedContact.entry.id, storedContact);
  }

  state.initialized = true;
  state.initializePromise = null;
  setContactsSnapshot(state, {
    entries: getSnapshotEntries(state.contactsById),
    ready: true,
  });
  if (state.contactsById.size > 0) {
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
      if (isDestroyedContactSyncRuntimeError(error)) {
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
  const result = await state.runtime.syncDocuments({
    addressBookId: DEFAULT_CONTACTS_ADDRESS_BOOK_ID,
    contacts: Array.from(state.contactsById.values()),
    persistence: state.persistence,
    ready: state.snapshot.ready,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
  });
  if (result.syncedContactCount > 0) {
    setContactsSnapshot(state, {
      entries: getSnapshotEntries(state.contactsById),
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
  if (hasContactDocumentUpdateEvent(nextEvents, state.contactsById.values())) {
    scheduleSync();
  }
}

async function importKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
  scheduleSync: () => void,
): Promise<string | null> {
  const entry = await state.runtime.fetchKeyEntry(userId);
  if (!entry) {
    return null;
  }

  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return null;
  }

  let importedContactId: string | null = null;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const existingContact =
        findContactByUserId(state.contactsById, entry.userId) ??
        state.contactsById.get(entry.id);
      const nextEntry = existingContact
        ? patchContactEntry(existingContact.entry, {
            encapsulationPublicKey: entry.encapsulationPublicKey,
            isSelf: existingContact.entry.isSelf || entry.isSelf,
            userId: entry.userId,
          })
        : entry;
      const imported = await state.runtime.persistContactEntry({
        entry: nextEntry,
        existingContact,
        persistence: state.persistence,
      });
      importedContactId = imported.contact.entry.id;
      if (!imported.changed) {
        return;
      }

      state.contactsById.set(imported.contact.entry.id, imported.contact);
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsById),
        ready: true,
      });
      scheduleSync();
    })
    .catch((error: unknown) => {
      state.runtime.logError("Failed to persist contact", error);
    });
  await state.writeChain;
  return importedContactId;
}

async function createContactFromRuntime(
  state: ContactsStoreState,
  patch: ContactEntryPatch,
  scheduleSync: () => void,
): Promise<string | null> {
  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return null;
  }

  const entry = createContactEntryFromPatch(patch);
  let createdContactId: string | null = null;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const persisted = await state.runtime.persistContactEntry({
        entry,
        persistence: state.persistence,
      });
      createdContactId = persisted.contact.entry.id;
      if (!persisted.changed) {
        return;
      }

      state.contactsById.set(persisted.contact.entry.id, persisted.contact);
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsById),
        ready: true,
      });
      scheduleSync();
    })
    .catch((error: unknown) => {
      state.runtime.logError("Failed to create contact", error);
    });
  await state.writeChain;
  return createdContactId;
}

async function updateContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
  scheduleSync: () => void,
) {
  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const existingContact = state.contactsById.get(contactId);
      if (!existingContact) {
        return;
      }

      const entry = patchContactEntry(existingContact.entry, patch);
      const persisted = await state.runtime.persistContactEntry({
        entry,
        existingContact,
        persistence: state.persistence,
      });
      if (!persisted.changed) {
        return;
      }

      state.contactsById.set(persisted.contact.entry.id, persisted.contact);
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsById),
        ready: true,
      });
      scheduleSync();
    })
    .catch((error: unknown) => {
      state.runtime.logError("Failed to update contact", error);
    });
  await state.writeChain;
}

async function removeContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  scheduleSync: () => void,
) {
  await waitForContactsInitialization(state, scheduleSync);
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!state.contactsById.has(contactId)) {
        return;
      }

      state.contactsById.delete(contactId);
      await state.runtime.removeContactEntry({
        contactId,
        persistence: state.persistence,
      });
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsById),
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
  if (nextRuntime.didProjectionKeyRuntimeChange(previousRuntime)) {
    state.resolveProjectionUserKey =
      nextRuntime.createProjectionUserKeyResolver();
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
    nextRuntime.didRegainSyncPrerequisites(previousRuntime)
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
  state.syncLane = registerContactSyncLane({
    domainScope: initialRuntime.domainScope,
    run: () => runContactsSyncIteration(state),
  });
  const scheduleSync = () => scheduleContactsSync(state);

  return {
    createContact: (patch: ContactEntryPatch) =>
      createContactFromRuntime(state, patch, scheduleSync),
    getSnapshot: () => state.snapshot,
    importKey: (userId: string) =>
      importKeyFromRuntime(state, userId, scheduleSync),
    removeContact: (contactId: string) =>
      removeContactFromRuntime(state, contactId, scheduleSync),
    subscribe: (listener: () => void) =>
      subscribeToContactsStore(state, listener),
    updateContact: (contactId: string, patch: ContactEntryPatch) =>
      updateContactFromRuntime(state, contactId, patch, scheduleSync),
    updateRuntime: (runtime: ContactsRuntime) =>
      updateContactsStoreRuntime(state, runtime, scheduleSync),
  };
}

export function getOrCreateContactsStore(
  domainScope: DomainScope,
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
