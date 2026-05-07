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
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createPendingUpdateFields,
  isDocumentUpdateCreatedEvent,
} from "../../data/documentSync";
import {
  type ContactsPersistence,
  sqlContactsPersistence,
} from "../../data/persistence/contacts/contactsPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  didRegainSyncPrerequisites,
  getOrCreateDomainSyncCoordinator,
  isDestroyedDatabaseClientError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  createRemoteContactDocument,
  syncRemoteContactDocument,
} from "../../workflows/contacts";

type ContactsDocument = Awaited<ReturnType<typeof createDocument>>;
type ContactsAppData = ReturnType<typeof useAppData>;
type EncapsulationKeyPair = NonNullable<
  ContactsRuntime["encapsulationKeyPair"]
>;
type ContactRemoteSyncAttempt = NonNullable<
  Awaited<ReturnType<typeof syncRemoteContactDocument>>
>;

interface ContactState {
  doc: ContactsDocument;
  entry: AddressBookEntry;
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
  apiClient: ContactsAppData["apiClient"];
  containerId: ContactsAppData["containerId"];
  dbStatus: ContactsAppData["dbStatus"];
  domainScope: ContactsAppData["domainScope"];
  encapsulationKeyPair: ContactsAppData["encapsulationKeyPair"];
  events: ContactsAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ContactsAppData["isAuthenticated"];
  log: ContactsAppData["log"];
  online: ContactsAppData["online"];
  organizationId?: ContactsAppData["organizationId"];
  signingFingerprint?: ContactsAppData["signingFingerprint"];
  signingKeyPair?: ContactsAppData["signingKeyPair"];
  userId?: ContactsAppData["userId"];
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

interface ContactsStoreState {
  contactsByUserId: Map<string, ContactState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  persistence: ContactsPersistence;
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

async function createContactDocument() {
  return createDocument(getScopedPeerSeed("contacts"));
}

type NullableContactRuntimeField =
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";

function resolveNullableContactRuntimeField(
  patch: Partial<DocumentRecord>,
  key: NullableContactRuntimeField,
  currentValue: string | null | undefined,
  resetWhenUnpatched = false,
): string | null {
  if (Object.hasOwn(patch, key)) {
    return patch[key] ?? null;
  }

  return resetWhenUnpatched ? null : (currentValue ?? null);
}

async function persistContact(
  state: ContactsStoreState,
  contact: ContactState,
  patch: Partial<DocumentRecord> = {},
): Promise<DocumentRecord> {
  const currentDocumentId = contact.record.documentId ?? null;
  const nextDocumentId = patch.documentId ?? currentDocumentId;
  const documentIdChanged = nextDocumentId !== currentDocumentId;
  const nextRecord: DocumentRecord = {
    id: contact.entry.userId,
    documentId: nextDocumentId,
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(contact.doc)),
    accessEpoch: patch.accessEpoch ?? contact.record.accessEpoch ?? 1,
    accessStateHash:
      patch.accessStateHash ?? contact.record.accessStateHash ?? null,
    lastCommitLsn: resolveNullableContactRuntimeField(
      patch,
      "lastCommitLsn",
      contact.record.lastCommitLsn,
      documentIdChanged,
    ),
    contentKeyBundle: resolveNullableContactRuntimeField(
      patch,
      "contentKeyBundle",
      contact.record.contentKeyBundle,
      documentIdChanged,
    ),
    documentKekTargets: resolveNullableContactRuntimeField(
      patch,
      "documentKekTargets",
      contact.record.documentKekTargets,
      documentIdChanged,
    ),
    documentManifestBundle: resolveNullableContactRuntimeField(
      patch,
      "documentManifestBundle",
      contact.record.documentManifestBundle,
      documentIdChanged,
    ),
  };

  await state.persistence.saveContact(
    state.runtime.execSql,
    ADDRESS_BOOK_ID,
    nextRecord,
    contact.entry,
  );
  contact.record = nextRecord;
  setContactsSnapshot(state, {
    entries: getSnapshotEntries(state.contactsByUserId),
    ready: true,
  });
  return nextRecord;
}

async function listPendingUpdates(
  state: ContactsStoreState,
  userId: string,
): Promise<PendingUpdateRecord[]> {
  return state.persistence.listPendingUpdates(state.runtime.execSql, userId);
}

async function enqueuePendingUpdate(
  state: ContactsStoreState,
  userId: string,
  update: Uint8Array,
  sourceVersionVector?: string | null,
) {
  const pendingUpdateFields = createPendingUpdateFields(
    update,
    sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await state.persistence.enqueuePendingUpdate(state.runtime.execSql, {
    userId,
    ...pendingUpdateFields,
  });
}

async function deletePendingUpdate(state: ContactsStoreState, id: string) {
  await state.persistence.deletePendingUpdate(state.runtime.execSql, id);
}

async function initializeStoredContact(
  state: ContactsStoreState,
  storedContact: Awaited<
    ReturnType<ContactsPersistence["loadContacts"]>
  >[number],
) {
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
    await enqueuePendingUpdate(state, entry.userId, initialUpdate);
    record = {
      id: entry.userId,
      documentId: null,
      loroSnapshot: bytesToBase64(initialUpdate),
      accessEpoch: 1,
      accessStateHash: null,
      lastCommitLsn: null,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    };
    await state.persistence.saveContact(
      state.runtime.execSql,
      ADDRESS_BOOK_ID,
      record,
      entry,
    );
  }

  state.contactsByUserId.set(entry.userId, {
    doc: nextDoc,
    entry,
    record,
  });
}

async function initializeContactsStore(
  state: ContactsStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.dbStatus !== "ready") {
    return;
  }

  await state.persistence.ensureSchema(state.runtime.execSql);
  const storedContacts = await state.persistence.loadContacts(
    state.runtime.execSql,
    ADDRESS_BOOK_ID,
  );

  for (const storedContact of storedContacts) {
    await initializeStoredContact(state, storedContact);
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

async function ensureContactDocumentForSync(
  state: ContactsStoreState,
  contact: ContactState,
  pendingUpdates: PendingUpdateRecord[],
  encapsulationKeyPair: EncapsulationKeyPair,
) {
  let documentId = contact.record.documentId;

  if (!documentId && pendingUpdates.length > 0) {
    if (!state.runtime.containerId) {
      return null;
    }

    const created = await createRemoteContactDocument({
      runtime: state.runtime,
      targetSecretKey: encapsulationKeyPair.secretKey,
    });
    if (!created) {
      return null;
    }

    documentId = created.documentId;
    await persistContact(state, contact, {
      ...created.persistedState,
      documentId,
    });
    state.runtime.log(
      `Created contact document: ${created.documentId} (${contact.entry.userId})`,
    );
  }

  return documentId;
}

async function applySyncedContactUpdates(
  state: ContactsStoreState,
  contact: ContactState,
  syncAttempt: ContactRemoteSyncAttempt,
) {
  const { outgoingUpdateCount, synced } = syncAttempt;

  for (const acceptedOutgoingUpdateId of synced.response
    .acceptedOutgoingUpdateIds) {
    await deletePendingUpdate(state, acceptedOutgoingUpdateId);
  }

  if (synced.decryptedUpdates.length > 0) {
    importUpdates(
      contact.doc,
      synced.decryptedUpdates.map((update) => update.updateData),
    );
    const updatedEntry = getEntryValue(
      contact.entry.userId,
      contact.doc,
      contact.entry.isSelf,
    );
    if (updatedEntry) {
      contact.entry = updatedEntry;
    }
  }

  await persistContact(state, contact, {
    ...synced.persistedState,
    lastCommitLsn:
      synced.response.commitLsn ?? contact.record.lastCommitLsn ?? null,
  });

  if (outgoingUpdateCount > synced.response.acceptedOutgoingUpdateIds.length) {
    requestContactsSync(state);
  }
}

async function syncSingleContact(
  state: ContactsStoreState,
  contact: ContactState,
  userId: string,
  encapsulationKeyPair: EncapsulationKeyPair,
) {
  const pendingUpdates = await listPendingUpdates(state, userId);
  const documentId = await ensureContactDocumentForSync(
    state,
    contact,
    pendingUpdates,
    encapsulationKeyPair,
  );

  if (!documentId) {
    return;
  }

  const syncAttempt = await syncRemoteContactDocument({
    contactEntry: contact.entry,
    documentId,
    lastCommitLsn: contact.record.lastCommitLsn,
    localVersionVector: encodeVersionVector(contact.doc),
    pendingUpdates,
    runtime: state.runtime,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!syncAttempt) {
    return;
  }

  await applySyncedContactUpdates(state, contact, syncAttempt);
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

    await syncSingleContact(state, contact, userId, encapsulationKeyPair);
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

  if (!existingContact) {
    const nextDoc = await createContactDocument();
    setEntryValue(nextDoc, entry);
    const initialUpdate = exportAllUpdates(nextDoc);
    const nextContact: ContactState = {
      doc: nextDoc,
      entry,
      record: {
        id: entry.userId,
        documentId: null,
        loroSnapshot: bytesToBase64(initialUpdate),
        accessEpoch: 1,
        accessStateHash: null,
        lastCommitLsn: null,
        contentKeyBundle: null,
        documentKekTargets: null,
        documentManifestBundle: null,
      },
    };

    await enqueuePendingUpdate(state, entry.userId, initialUpdate);
    state.contactsByUserId.set(entry.userId, nextContact);
    await persistContact(state, nextContact);
  } else {
    const previousVersion = encodeVersionVector(existingContact.doc);
    setEntryValue(existingContact.doc, entry);
    existingContact.entry = entry;
    await enqueuePendingUpdate(
      state,
      entry.userId,
      exportUpdatesSince(existingContact.doc, previousVersion),
    );
    await persistContact(state, existingContact);
  }

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
      console.error("Failed to persist contact:", error);
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
      await state.persistence.deleteContact(
        state.runtime.execSql,
        ADDRESS_BOOK_ID,
        userId,
      );
      setContactsSnapshot(state, {
        entries: getSnapshotEntries(state.contactsByUserId),
        ready: true,
      });
      state.runtime.log("Peer key removed");
    })
    .catch((error: unknown) => {
      console.error("Failed to remove contact:", error);
    });
  await state.writeChain;
}

function updateContactsStoreRuntime(
  state: ContactsStoreState,
  nextRuntime: ContactsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
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
  persistence: ContactsPersistence = sqlContactsPersistence,
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
