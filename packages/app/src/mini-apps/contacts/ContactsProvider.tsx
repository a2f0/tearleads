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
  getOrCreateDocumentEncryptionMaterial,
  isDocumentUpdateCreatedEvent,
  maybeSeedRewrappedDocumentRecipientEnvelopes,
  parseDocumentRecipientEnvelopes,
  requiresBaselineAfterDocumentEpochChange,
  resolveIncomingUpdateDecryptionMaterial,
  resolveRecipientPublicKeys,
  resolveSyncedDocumentRecipientEnvelopes,
  serializeDocumentRecipientEnvelopes,
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
  cacheReferencedPrincipalPolicies: ContactsAppData["cacheReferencedPrincipalPolicies"];
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

interface ContactsStoreState {
  contactsByUserId: Map<string, ContactState>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  lastEventCount: number;
  listeners: Set<() => void>;
  persistence: ContactsPersistence;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  syncPromise: Promise<void> | null;
  syncRequested: boolean;
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
    syncPromise: null,
    syncRequested: false,
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
  state.syncPromise = null;
  state.syncRequested = false;
  state.writeChain = Promise.resolve();
  setContactsSnapshot(state, {
    entries: [],
    ready: false,
  });
}

async function createContactDocument() {
  return createDocument(getScopedPeerSeed("contacts"));
}

async function persistContact(
  state: ContactsStoreState,
  contact: ContactState,
  patch: Partial<DocumentRecord> = {},
): Promise<DocumentRecord> {
  const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
    patch,
    "documentRecipientEnvelopes",
  );
  const nextRecord: DocumentRecord = {
    id: contact.entry.userId,
    documentId: patch.documentId ?? contact.record.documentId ?? null,
    documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
      ? (patch.documentRecipientEnvelopes ?? null)
      : (contact.record.documentRecipientEnvelopes ?? null),
    loroSnapshot:
      patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(contact.doc)),
    accessEpoch: patch.accessEpoch ?? contact.record.accessEpoch ?? 1,
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

async function replacePendingUpdatesWithBaseline(
  state: ContactsStoreState,
  contact: ContactState,
  sourceVersionVector?: string | null,
) {
  await state.persistence.deletePendingUpdates(
    state.runtime.execSql,
    contact.entry.userId,
  );
  await enqueuePendingUpdate(
    state,
    contact.entry.userId,
    exportAllUpdates(contact.doc),
    sourceVersionVector,
  );
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
      documentRecipientEnvelopes: null,
      loroSnapshot: bytesToBase64(initialUpdate),
      accessEpoch: 1,
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
    recipientPublicKeys: getLocalRecipientPublicKeys(
      state.runtime.encapsulationKeyPair,
    ),
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
      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
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
) {
  let documentId = contact.record.documentId;

  if (!documentId && pendingUpdates.length > 0) {
    if (!state.runtime.containerId) {
      return null;
    }

    const created = await state.runtime.apiClient.createDocument([
      state.runtime.containerId,
    ]);
    if (!created) {
      return null;
    }

    await state.runtime.cacheReferencedPrincipalPolicies(
      created.referencedPrincipals,
    );

    contact.recipientPublicKeys = resolveRecipientPublicKeys(
      created.recipientEncapsulationPublicKeys,
      getLocalRecipientPublicKeys(state.runtime.encapsulationKeyPair),
    );
    documentId = created.id;
    await persistContact(state, contact, {
      documentId,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        created.documentRecipientEnvelopes,
      ),
      accessEpoch: created.currentAccessEpoch,
    });
    state.runtime.log(
      `Created contact document: ${created.id} (${contact.entry.userId})`,
    );
  }

  return documentId;
}

async function buildContactOutgoingSync(
  contact: ContactState,
  execSql: ContactsRuntime["execSql"],
  pendingUpdates: PendingUpdateRecord[],
  secretKey: Uint8Array,
) {
  const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
    contact.record.documentRecipientEnvelopes,
  );
  const encryptionMaterial =
    pendingUpdates.length > 0
      ? await getOrCreateDocumentEncryptionMaterial({
          documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
          execSql,
          recipientPublicKeys: contact.recipientPublicKeys,
          secretKey,
        })
      : null;
  const outgoingUpdates = encryptionMaterial
    ? await encryptPendingUpdates(
        pendingUpdates,
        contact.record.accessEpoch,
        encryptionMaterial.documentKey,
      )
    : [];

  return {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates,
  };
}

async function applySyncedContactUpdates(
  state: ContactsStoreState,
  contact: ContactState,
  documentId: string,
  synced: NonNullable<
    Awaited<ReturnType<ContactsRuntime["apiClient"]["syncDocument"]>>
  >,
  currentDocumentRecipientEnvelopes: ReturnType<
    typeof parseDocumentRecipientEnvelopes
  >,
  encryptionMaterial: Awaited<
    ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
  > | null,
  outgoingUpdateCount: number,
  secretKey: Uint8Array,
) {
  contact.recipientPublicKeys = resolveRecipientPublicKeys(
    synced.recipientEncapsulationPublicKeys,
    getLocalRecipientPublicKeys(state.runtime.encapsulationKeyPair),
  );

  for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
    await deletePendingUpdate(state, acceptedOutgoingUpdateId);
  }

  const previousAccessEpoch = contact.record.accessEpoch;
  const nextDocumentRecipientEnvelopes =
    resolveSyncedDocumentRecipientEnvelopes({
      currentAccessEpoch: previousAccessEpoch,
      currentDocumentRecipientEnvelopes,
      generatedDocumentRecipientEnvelopes:
        encryptionMaterial?.documentRecipientEnvelopes ?? null,
      synced,
    });

  if (synced.updates.length > 0) {
    const decryptionMaterial = resolveIncomingUpdateDecryptionMaterial({
      currentDocumentRecipientEnvelopes,
      nextDocumentRecipientEnvelopes,
      previousAccessEpoch,
      synced,
    });

    if (!decryptionMaterial) {
      state.runtime.log(
        `Contacts (${contact.entry.userId}): skipped incoming updates because the current document key bundle is missing.`,
      );
    } else {
      const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
        documentRecipientEnvelopes:
          decryptionMaterial.documentRecipientEnvelopes,
        execSql: state.runtime.execSql,
        recipientPublicKeys: contact.recipientPublicKeys,
        secretKey,
      });
      const decrypted = await decryptIncomingUpdates(
        synced.updates,
        decryptionMaterial.accessEpoch,
        documentKey,
        (message) =>
          state.runtime.log(`Contacts (${contact.entry.userId}): ${message}`),
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
  }

  await persistContact(state, contact, {
    documentId,
    accessEpoch: synced.currentAccessEpoch,
    documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
      nextDocumentRecipientEnvelopes,
    ),
  });

  if (synced.currentAccessEpoch !== previousAccessEpoch) {
    if (
      requiresBaselineAfterDocumentEpochChange({
        previousAccessEpoch,
        resolvedDocumentRecipientEnvelopes: nextDocumentRecipientEnvelopes,
        synced,
      })
    ) {
      await replacePendingUpdatesWithBaseline(
        state,
        contact,
        synced.documentRecipientEnvelopeAction === "rotate"
          ? synced.rotateBaselineSourceVersionVector
          : null,
      );
    }
    state.syncRequested = true;
  }

  if (outgoingUpdateCount > synced.acceptedOutgoingUpdateIds.length) {
    state.syncRequested = true;
  }
}

async function syncSingleContact(
  state: ContactsStoreState,
  contact: ContactState,
  userId: string,
  secretKey: Uint8Array,
) {
  const pendingUpdates = await listPendingUpdates(state, userId);
  const documentId = await ensureContactDocumentForSync(
    state,
    contact,
    pendingUpdates,
  );

  if (!documentId) {
    return;
  }

  const {
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates,
  } = await buildContactOutgoingSync(
    contact,
    state.runtime.execSql,
    pendingUpdates,
    secretKey,
  );
  let synced = await state.runtime.apiClient.syncDocument(
    documentId,
    contact.record.accessEpoch,
    encodeVersionVector(contact.doc),
    outgoingUpdates,
    encryptionMaterial && currentDocumentRecipientEnvelopes === null
      ? encryptionMaterial.documentRecipientEnvelopes
      : undefined,
  );

  if (!synced) {
    return;
  }

  synced = await maybeSeedRewrappedDocumentRecipientEnvelopes({
    currentAccessEpoch: contact.record.accessEpoch,
    currentDocumentRecipientEnvelopes,
    documentId,
    execSql: state.runtime.execSql,
    localVersionVector: encodeVersionVector(contact.doc),
    recipientPublicKeys: contact.recipientPublicKeys,
    secretKey,
    syncDocument: state.runtime.apiClient.syncDocument,
    synced,
  });

  await state.runtime.cacheReferencedPrincipalPolicies(
    synced.referencedPrincipals,
  );

  await applySyncedContactUpdates(
    state,
    contact,
    documentId,
    synced,
    currentDocumentRecipientEnvelopes,
    encryptionMaterial,
    outgoingUpdates.length,
    secretKey,
  );
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

    await syncSingleContact(
      state,
      contact,
      userId,
      encapsulationKeyPair.secretKey,
    );
  }
}

function scheduleContactsSync(state: ContactsStoreState) {
  state.syncRequested = true;
  if (state.syncPromise) {
    return;
  }

  state.syncPromise = (async () => {
    while (state.syncRequested) {
      state.syncRequested = false;

      try {
        await runContactsSyncIteration(state);
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
    state.syncPromise = null;
  });
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
      recipientPublicKeys: getLocalRecipientPublicKeys(
        state.runtime.encapsulationKeyPair,
      ),
      record: {
        id: entry.userId,
        documentId: null,
        documentRecipientEnvelopes: null,
        loroSnapshot: bytesToBase64(initialUpdate),
        accessEpoch: 1,
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

  for (const contact of state.contactsByUserId.values()) {
    if (!contact.record.documentId) {
      contact.recipientPublicKeys = getLocalRecipientPublicKeys(
        state.runtime.encapsulationKeyPair,
      );
    }
  }

  if (nextRuntime.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetContactsStore(state);
    }
    state.lastEventCount = nextRuntime.events.length;
    return;
  }

  ensureContactsInitialized(state, scheduleSync);

  const regainedSyncPrerequisites =
    (!previousRuntime.online && nextRuntime.online) ||
    (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
    (!previousRuntime.encapsulationKeyPair &&
      !!nextRuntime.encapsulationKeyPair);

  handleContactsRemoteEvents(state, scheduleSync);

  if (state.snapshot.ready && regainedSyncPrerequisites) {
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
