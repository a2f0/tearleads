import type { DocumentStore } from "@symcrypt/client-sdk";
import { loadProjectedContacts } from "./contactProjection";
import { sortContactEntries } from "./contactSnapshot";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import {
  setContactsSnapshot,
  upsertContactEntry,
} from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";

export function hasContactsContainerRuntime(
  state: ContactsStoreState,
): boolean {
  const containerId = state.runtime.documents.state.containerId;
  return typeof containerId === "string" && containerId.length > 0;
}

export function ensureContactDocumentStore(
  state: ContactsStoreState,
  contactId: string,
  options: { readonly deferRemoteSync?: boolean | undefined } = {},
): DocumentStore {
  const existing = state.contactDocumentStoresById.get(contactId);
  if (existing) {
    existing.store.updateRuntime(state.runtime.documents);
    return existing.store;
  }

  const store = state.runtime.openDocumentStore({
    containerId: state.runtime.documents.state.containerId,
    documentId: null,
    initialText: "",
    localId: contactId,
    ...(options.deferRemoteSync ? {} : { initialDocumentKind: "contact" }),
  });
  const unsubscribe = store.subscribe(() => {
    const entry = contactEntryFromDocumentStore(contactId, store);
    if (entry) {
      upsertContactEntry(state, entry);
      state.onContactEntry(entry);
    }
  });
  state.contactDocumentStoresById.set(contactId, { store, unsubscribe });
  return store;
}

export function resetContactsStore(state: ContactsStoreState): void {
  state.persistedDocumentsUnsubscribe?.();
  state.persistedDocumentsUnsubscribe = null;
  for (const trackedStore of state.contactDocumentStoresById.values()) {
    trackedStore.unsubscribe();
  }
  state.contactDocumentStoresById.clear();
  state.entriesById.clear();
  state.initializationGeneration += 1;
  state.initialized = false;
  state.initializePromise = null;
  state.pendingSnapshotFlush = false;
  state.writeChain = Promise.resolve();
  setContactsSnapshot(state, { entries: [], ready: false });
}

async function initializeContactsStore(
  state: ContactsStoreState,
  generation: number,
): Promise<void> {
  const documentsRuntime = state.runtime.documents;
  if (documentsRuntime.infra.dbStatus !== "ready") {
    return;
  }
  const containerId = documentsRuntime.state.containerId;
  if (!containerId) {
    return;
  }
  const execSql = documentsRuntime.infra.execSql;

  const entries = await loadProjectedContacts(execSql, containerId);
  if (
    state.initializationGeneration !== generation ||
    state.runtime.documents.state.containerId !== containerId ||
    state.runtime.documents.infra.dbStatus !== "ready" ||
    state.runtime.documents.infra.execSql !== execSql
  ) {
    return;
  }
  state.entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  setContactsSnapshot(state, {
    entries: sortContactEntries([...state.entriesById.values()]),
    ready: true,
  });
  for (const entry of entries) {
    ensureContactDocumentStore(state, entry.id);
    state.onContactEntry(entry);
  }
  state.initialized = true;
}

export function ensureContactsInitialized(state: ContactsStoreState): void {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state)
  ) {
    return;
  }

  const generation = state.initializationGeneration;
  const initializePromise = initializeContactsStore(state, generation)
    .catch((error: unknown) => {
      if (state.initializationGeneration !== generation) {
        return;
      }
      state.dependencies.logError("Contacts: failed to load contacts.", error);
    })
    .finally(() => {
      if (state.initializePromise === initializePromise) {
        state.initializePromise = null;
      }
    });
  state.initializePromise = initializePromise;
}

export async function waitForContactsInitialization(
  state: ContactsStoreState,
): Promise<void> {
  ensureContactsInitialized(state);
  if (state.initializePromise) {
    await state.initializePromise;
  }
}
