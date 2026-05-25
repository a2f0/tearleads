import type {
  DocumentStore,
  DocumentsRuntime,
  DomainScope,
  PrimeDocumentStoreInput,
  UserKey,
} from "@tearleads/client-sdk";
import { getDocumentClientProjectionTables } from "@tearleads/client-sdk";
import {
  type ExecSql,
  ensureSqlTables,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { sql } from "drizzle-orm";
import {
  type ContactEntry,
  type ContactEntryPatch,
  contactEntryToStructuredFieldPatch,
  contactFieldsToEntry,
  readContactFields,
} from "../../document-types/contact/contactDocumentModel";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  contactProjection,
} from "../../document-types/projectors";

export interface ContactsSnapshot {
  entries: ReadonlyArray<ContactEntry>;
  ready: boolean;
}

export interface ContactsRuntime {
  deleteLocalDocument: (localId: string) => Promise<boolean>;
  documents: DocumentsRuntime;
  execSql: ExecSql;
  primeDocumentStore: (input: PrimeDocumentStoreInput) => DocumentStore;
}

export interface ContactsStore {
  createContact: (patch: ContactEntryPatch) => Promise<string | null>;
  getSnapshot: () => ContactsSnapshot;
  importKey: (userId: string) => Promise<string | null>;
  removeContact: (contactId: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateContact: (contactId: string, patch: ContactEntryPatch) => Promise<void>;
  updateRuntime: (runtime: ContactsRuntime) => void;
}

interface ContactsStoreDependencies {
  fetchUserKey: (userId: string) => Promise<UserKey | null>;
  logError: (message: string | Error, cause?: unknown) => void;
}

interface TrackedContactDocumentStore {
  store: DocumentStore;
  unsubscribe: () => void;
}

interface ContactsStoreState {
  contactDocumentStoresById: Map<string, TrackedContactDocumentStore>;
  dependencies: ContactsStoreDependencies;
  entriesById: Map<string, ContactEntry>;
  initializePromise: Promise<void> | null;
  initialized: boolean;
  listeners: Set<() => void>;
  pendingSnapshotFlush: boolean;
  runtime: ContactsRuntime;
  snapshot: ContactsSnapshot;
  writeChain: Promise<void>;
}

const contactsStoresByScope = new WeakMap<DomainScope, ContactsStore>();

function normalizeProjectionNullableText(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

function compareContactText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNullableContactText(
  left: string | null,
  right: string | null,
): number {
  return compareContactText(left ?? "", right ?? "");
}

function sortEntries(entries: ReadonlyArray<ContactEntry>): ContactEntry[] {
  return [...entries].sort((left, right) => {
    return (
      compareContactText(left.lastName, right.lastName) ||
      compareContactText(left.firstName, right.firstName) ||
      compareNullableContactText(left.userId, right.userId) ||
      compareContactText(left.id, right.id)
    );
  });
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

function setContactsSnapshot(
  state: ContactsStoreState,
  next: ContactsSnapshot,
): void {
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
  for (const listener of state.listeners) {
    listener();
  }
}

function flushContactsSnapshot(state: ContactsStoreState): void {
  state.pendingSnapshotFlush = false;
  setContactsSnapshot(state, {
    entries: sortEntries([...state.entriesById.values()]),
    ready: true,
  });
}

function scheduleContactsSnapshotFlush(state: ContactsStoreState): void {
  if (state.pendingSnapshotFlush) {
    return;
  }

  state.pendingSnapshotFlush = true;
  queueMicrotask(() => {
    if (state.pendingSnapshotFlush) {
      flushContactsSnapshot(state);
    }
  });
}

function upsertContactEntry(
  state: ContactsStoreState,
  entry: ContactEntry,
): void {
  const existingEntry = state.entriesById.get(entry.id);
  if (existingEntry && sameContactEntry(existingEntry, entry)) {
    return;
  }

  state.entriesById.set(entry.id, entry);
  scheduleContactsSnapshotFlush(state);
}

function removeContactEntry(
  state: ContactsStoreState,
  contactId: string,
): void {
  if (!state.entriesById.delete(contactId)) {
    return;
  }

  scheduleContactsSnapshotFlush(state);
}

async function ensureContactProjectionSchema(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(
    execSql,
    getDocumentClientProjectionTables(APP_DOCUMENT_PROJECTOR_DEFINITIONS),
  );
}

async function loadProjectedContacts(
  execSql: ExecSql,
): Promise<ContactEntry[]> {
  await ensureContactProjectionSchema(execSql);
  const { db } = getSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      encapsulationPublicKey: contactProjection.encapsulationPublicKey,
      firstName: contactProjection.firstName,
      isSelf: contactProjection.isSelf,
      lastName: contactProjection.lastName,
      localId: contactProjection.localId,
      userId: contactProjection.userId,
    })
    .from(contactProjection)
    .orderBy(
      sql`${contactProjection.lastName} COLLATE NOCASE`,
      sql`${contactProjection.firstName} COLLATE NOCASE`,
      sql`${contactProjection.userId} COLLATE NOCASE`,
      sql`${contactProjection.localId} COLLATE NOCASE`,
    );

  return rows.map((row) => ({
    encapsulationPublicKey: normalizeProjectionNullableText(
      row.encapsulationPublicKey,
    ),
    firstName: row.firstName,
    id: row.localId,
    isSelf: row.isSelf === 1,
    lastName: row.lastName,
    userId: normalizeProjectionNullableText(row.userId),
  }));
}

function contactEntryFromDocumentStore(
  contactId: string,
  store: DocumentStore,
): ContactEntry | null {
  const snapshot = store.getSnapshot();
  if (!snapshot.ready || snapshot.documentKind !== "contact") {
    return null;
  }

  return contactFieldsToEntry(
    contactId,
    readContactFields(snapshot.structuredFields),
  );
}

function ensureContactDocumentStore(
  state: ContactsStoreState,
  contactId: string,
): DocumentStore {
  const existing = state.contactDocumentStoresById.get(contactId);
  if (existing) {
    existing.store.updateRuntime(state.runtime.documents);
    return existing.store;
  }

  const store = state.runtime.primeDocumentStore({
    containerId: null,
    documentId: null,
    initialDocumentKind: "contact",
    initialText: "",
    localId: contactId,
  });
  const unsubscribe = store.subscribe(() => {
    const entry = contactEntryFromDocumentStore(contactId, store);
    if (entry) {
      upsertContactEntry(state, entry);
    }
  });
  state.contactDocumentStoresById.set(contactId, { store, unsubscribe });
  void store.ensureInitialized().catch((error: unknown) => {
    state.dependencies.logError(
      "Contacts: failed to initialize contact.",
      error,
    );
  });
  return store;
}

function resetContactsStore(state: ContactsStoreState): void {
  for (const trackedStore of state.contactDocumentStoresById.values()) {
    trackedStore.unsubscribe();
  }
  state.contactDocumentStoresById.clear();
  state.entriesById.clear();
  state.initialized = false;
  state.initializePromise = null;
  state.pendingSnapshotFlush = false;
  state.writeChain = Promise.resolve();
  setContactsSnapshot(state, { entries: [], ready: false });
}

async function initializeContactsStore(
  state: ContactsStoreState,
): Promise<void> {
  if (state.runtime.documents.dbStatus !== "ready") {
    return;
  }

  const entries = await loadProjectedContacts(state.runtime.execSql);
  state.entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  setContactsSnapshot(state, {
    entries: sortEntries([...state.entriesById.values()]),
    ready: true,
  });
  for (const entry of entries) {
    ensureContactDocumentStore(state, entry.id);
  }
  state.initialized = true;
  state.initializePromise = null;
}

function ensureContactsInitialized(state: ContactsStoreState): void {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.documents.dbStatus !== "ready"
  ) {
    return;
  }

  state.initializePromise = initializeContactsStore(state).catch(
    (error: unknown) => {
      state.initializePromise = null;
      state.dependencies.logError("Contacts: failed to load contacts.", error);
    },
  );
}

async function waitForContactsInitialization(
  state: ContactsStoreState,
): Promise<void> {
  ensureContactsInitialized(state);
  if (state.initializePromise) {
    await state.initializePromise;
  }
}

function findContactByUserId(
  entriesById: ReadonlyMap<string, ContactEntry>,
  userId: string,
): ContactEntry | null {
  for (const entry of entriesById.values()) {
    if (entry.userId === userId) {
      return entry;
    }
  }

  return null;
}

async function writeContactPatch(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
): Promise<void> {
  const store = ensureContactDocumentStore(state, contactId);
  const ready = await store.ensureInitialized();
  if (!ready) {
    return;
  }

  await store.setStructuredFields(
    "contact",
    contactEntryToStructuredFieldPatch(patch),
  );
  const entry = contactEntryFromDocumentStore(contactId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}

async function createContactFromRuntime(
  state: ContactsStoreState,
  patch: ContactEntryPatch,
): Promise<string | null> {
  await waitForContactsInitialization(state);
  if (state.runtime.documents.dbStatus !== "ready") {
    return null;
  }

  const contactId = crypto.randomUUID();
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(() => writeContactPatch(state, contactId, patch))
    .catch((error: unknown) => {
      state.dependencies.logError("Contacts: failed to create contact.", error);
    });
  await state.writeChain;
  return contactId;
}

async function updateContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
): Promise<void> {
  await waitForContactsInitialization(state);
  if (state.runtime.documents.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(() => writeContactPatch(state, contactId, patch))
    .catch((error: unknown) => {
      state.dependencies.logError("Contacts: failed to update contact.", error);
    });
  await state.writeChain;
}

async function importKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
): Promise<string | null> {
  const userKey = await state.dependencies.fetchUserKey(userId);
  if (!userKey) {
    return null;
  }

  await waitForContactsInitialization(state);
  if (state.runtime.documents.dbStatus !== "ready") {
    return null;
  }

  const existingContact = findContactByUserId(
    state.entriesById,
    userKey.userId,
  );
  const contactId = existingContact?.id ?? userKey.userId;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(() =>
      writeContactPatch(state, contactId, {
        encapsulationPublicKey: userKey.encapsulationPublicKey,
        isSelf: userKey.userId === state.runtime.documents.userId,
        userId: userKey.userId,
      }),
    )
    .catch((error: unknown) => {
      state.dependencies.logError(
        "Contacts: failed to import user key.",
        error,
      );
    });
  await state.writeChain;
  return contactId;
}

async function removeContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
): Promise<void> {
  await waitForContactsInitialization(state);
  if (state.runtime.documents.dbStatus !== "ready") {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const trackedStore = state.contactDocumentStoresById.get(contactId);
      trackedStore?.unsubscribe();
      state.contactDocumentStoresById.delete(contactId);
      await state.runtime.deleteLocalDocument(contactId);
      removeContactEntry(state, contactId);
    })
    .catch((error: unknown) => {
      state.dependencies.logError("Contacts: failed to remove contact.", error);
    });
  await state.writeChain;
}

export function createContactsStore(
  initialRuntime: ContactsRuntime,
  dependencies: ContactsStoreDependencies,
): ContactsStore {
  const state: ContactsStoreState = {
    contactDocumentStoresById: new Map(),
    dependencies,
    entriesById: new Map(),
    initialized: false,
    initializePromise: null,
    listeners: new Set(),
    pendingSnapshotFlush: false,
    runtime: initialRuntime,
    snapshot: { entries: [], ready: false },
    writeChain: Promise.resolve(),
  };

  return {
    createContact: (patch) => createContactFromRuntime(state, patch),
    getSnapshot: () => state.snapshot,
    importKey: (userId) => importKeyFromRuntime(state, userId),
    removeContact: (contactId) => removeContactFromRuntime(state, contactId),
    subscribe(listener) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    updateContact: (contactId, patch) =>
      updateContactFromRuntime(state, contactId, patch),
    updateRuntime(runtime) {
      state.runtime = runtime;
      for (const trackedStore of state.contactDocumentStoresById.values()) {
        trackedStore.store.updateRuntime(runtime.documents);
      }

      if (runtime.documents.dbStatus !== "ready") {
        if (state.snapshot.ready || state.initialized) {
          resetContactsStore(state);
        }
        return;
      }

      ensureContactsInitialized(state);
    },
  };
}

export function getOrCreateContactsStore(
  domainScope: DomainScope,
  runtime: ContactsRuntime,
  dependencies: ContactsStoreDependencies,
): ContactsStore {
  const existingStore = contactsStoresByScope.get(domainScope);
  if (existingStore) {
    existingStore.updateRuntime(runtime);
    return existingStore;
  }

  const store = createContactsStore(runtime, dependencies);
  contactsStoresByScope.set(domainScope, store);
  return store;
}
