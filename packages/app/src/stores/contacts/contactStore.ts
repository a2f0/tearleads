import type { DomainScope } from "@tearleads/client-sdk";
import {
  type ContactEntryPatch,
  contactEntryToStructuredFieldPatch,
} from "../../document-types/contact/contactDocumentModel";
import { loadContactDocumentSummary } from "./contactDocumentSummary";
import {
  ensureContactDocumentStore,
  ensureContactsInitialized,
  hasContactsContainerRuntime,
  resetContactsStore,
  waitForContactsInitialization,
} from "./contactStoreInitialization";
import {
  contactEntryFromDocumentStore,
  findContactByUserId,
  findSelfContact,
  getUserKeyForSelfContact,
} from "./contactStoreLookup";
import { connectContactsStoreToPersistedDocuments } from "./contactStorePersistedDocuments";
import {
  removeContactEntry,
  upsertContactEntry,
} from "./contactStoreSnapshotMutations";
import type {
  ContactsRuntime,
  ContactsStore,
  ContactsStoreDependencies,
  ContactsStoreState,
} from "./contactStoreTypes";
import {
  type EnsureSelfContactInput,
  findPrimarySelfContact,
  getSelfContactLocalId,
  isSelfContactCurrent,
  normalizeEnsureSelfContactInput,
  type ResolvedSelfContactIdentity,
  resolveSelfContactId,
  shouldRemoveDuplicateSelfContact,
  toResolvedSelfContactIdentity,
} from "./selfContact";

export type { ContactsRuntime, ContactsStore, EnsureSelfContactInput };
export { getSelfContactLocalId };

const contactsStoresByScope = new WeakMap<DomainScope, ContactsStore>();

async function writeContactPatch(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
  options: { readonly deferRemoteSync?: boolean | undefined } = {},
): Promise<void> {
  const store = ensureContactDocumentStore(state, contactId, options);
  const snapshot = store.getSnapshot();
  if (snapshot.ready && !snapshot.canWrite) {
    return;
  }

  await store.setStructuredFields(
    "contact",
    contactEntryToStructuredFieldPatch(patch),
    { deferRemoteSync: options.deferRemoteSync },
  );
  const entry = contactEntryFromDocumentStore(contactId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}

function canWriteContactEntry(
  state: ContactsStoreState,
  contactId: string,
): boolean {
  const entry = state.entriesById.get(contactId);
  if (entry && entry.canWrite === false) {
    return false;
  }

  const trackedStore = state.contactDocumentStoresById.get(contactId);
  return trackedStore ? trackedStore.store.getSnapshot().canWrite : true;
}

async function createContactFromRuntime(
  state: ContactsStoreState,
  patch: ContactEntryPatch,
): Promise<string | null> {
  await waitForContactsInitialization(state);
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state)
  ) {
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

async function resolveSelfContactIdentity(
  state: ContactsStoreState,
  input: string | EnsureSelfContactInput,
): Promise<ResolvedSelfContactIdentity | null> {
  const normalizedInput = normalizeEnsureSelfContactInput(input);
  if (
    normalizedInput.userId &&
    !normalizedInput.encapsulationPublicKey?.trim()
  ) {
    const userKey = await getUserKeyForSelfContact(
      state.dependencies,
      normalizedInput.userId,
    );
    return userKey
      ? toResolvedSelfContactIdentity(normalizedInput, userKey)
      : null;
  }

  return toResolvedSelfContactIdentity(normalizedInput);
}

async function removeDuplicateSelfContacts(
  state: ContactsStoreState,
  primaryContactId: string,
  identity: ResolvedSelfContactIdentity,
): Promise<void> {
  for (const entry of state.entriesById.values()) {
    if (!shouldRemoveDuplicateSelfContact(entry, primaryContactId, identity)) {
      continue;
    }

    const trackedStore = state.contactDocumentStoresById.get(entry.id);
    trackedStore?.unsubscribe();
    state.contactDocumentStoresById.delete(entry.id);
    await state.runtime.deleteDocument(entry.id);
    removeContactEntry(state, entry.id);
  }
}

async function ensureSelfContactFromRuntime(
  state: ContactsStoreState,
  input: string | EnsureSelfContactInput,
): Promise<string | null> {
  await waitForContactsInitialization(state);
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state)
  ) {
    return null;
  }

  const identity = await resolveSelfContactIdentity(state, input);
  if (!identity) {
    return null;
  }

  const existingContact = findPrimarySelfContact(state.entriesById, identity);
  const contactId = resolveSelfContactId(existingContact, identity);
  if (!contactId) {
    return null;
  }
  const current = isSelfContactCurrent(existingContact, identity);
  const deferRemoteSync =
    typeof input !== "string" && input.deferRemoteSync === true;

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!current || !deferRemoteSync) {
        await removeDuplicateSelfContacts(state, contactId, identity);
        await writeContactPatch(
          state,
          contactId,
          {
            encapsulationPublicKey: identity.encapsulationPublicKey,
            isSelf: true,
            userId: identity.userId,
          },
          {
            deferRemoteSync,
          },
        );
        return;
      }
      await removeDuplicateSelfContacts(state, contactId, identity);
    })
    .catch((error: unknown) => {
      state.dependencies.logError(
        "Contacts: failed to ensure self contact.",
        error,
      );
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
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state) ||
    !canWriteContactEntry(state, contactId)
  ) {
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
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state)
  ) {
    return null;
  }

  const isSelf = userKey.userId === state.runtime.documents.auth.userId;
  const existingContact = isSelf
    ? findSelfContact(state.entriesById, userKey.userId)
    : findContactByUserId(state.entriesById, userKey.userId);
  const contactId = existingContact?.id ?? userKey.userId;
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const identity = toResolvedSelfContactIdentity({
        encapsulationPublicKey: userKey.encapsulationPublicKey,
        userId: userKey.userId,
      });
      await writeContactPatch(state, contactId, {
        encapsulationPublicKey: userKey.encapsulationPublicKey,
        isSelf,
        userId: userKey.userId,
      });
      if (isSelf && identity) {
        await removeDuplicateSelfContacts(state, contactId, identity);
      }
    })
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
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state) ||
    !state.runtime.trashContainerId ||
    !canWriteContactEntry(state, contactId)
  ) {
    return;
  }

  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      const contactDocument = await loadContactDocumentSummary(
        state,
        contactId,
      );
      if (!contactDocument) {
        state.dependencies.logError(
          `Contacts: failed to remove contact because document ${contactId} could not be loaded.`,
        );
        return;
      }
      if (!state.runtime.trashContainerId) {
        return;
      }

      const movedContact = await state.runtime.moveDocumentToTrash(
        contactDocument,
        state.runtime.trashContainerId,
      );
      if (!movedContact) {
        return;
      }

      const trackedStore = state.contactDocumentStoresById.get(contactId);
      trackedStore?.unsubscribe();
      state.contactDocumentStoresById.delete(contactId);
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
    initializationGeneration: 0,
    initialized: false,
    initializePromise: null,
    listeners: new Set(),
    pendingSnapshotFlush: false,
    persistedDocumentsUnsubscribe: null,
    runtime: initialRuntime,
    snapshot: { entries: [], ready: false },
    writeChain: Promise.resolve(),
  };
  connectContactsStoreToPersistedDocuments(state);

  return {
    createContact: (patch) => createContactFromRuntime(state, patch),
    ensureSelfContact: (userId) => ensureSelfContactFromRuntime(state, userId),
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
      const previousContainerId = state.runtime.documents.state.containerId;
      const previousDbStatus = state.runtime.documents.infra.dbStatus;
      const previousDomainScope = state.runtime.documents.state.domainScope;
      const previousExecSql = state.runtime.documents.infra.execSql;
      // The listener registry is domain-scoped. Its wrapper function is rebuilt
      // with normal runtime snapshots, so function identity is not a stable
      // subscription target; domain + availability are.
      const previousCanSubscribe =
        state.runtime.subscribeToPersistedDocuments !== undefined;
      const nextContainerId = runtime.documents.state.containerId;
      const subscriptionAvailabilityChanged =
        previousCanSubscribe !==
        (runtime.subscribeToPersistedDocuments !== undefined);
      state.runtime = runtime;
      let didReset = false;
      if (
        previousContainerId !== nextContainerId ||
        previousDbStatus !== runtime.documents.infra.dbStatus ||
        previousDomainScope !== runtime.documents.state.domainScope ||
        previousExecSql !== runtime.documents.infra.execSql
      ) {
        resetContactsStore(state);
        didReset = true;
      }
      for (const trackedStore of state.contactDocumentStoresById.values()) {
        trackedStore.store.updateRuntime(runtime.documents);
      }

      if (
        runtime.documents.infra.dbStatus !== "ready" ||
        !hasContactsContainerRuntime(state)
      ) {
        if (
          state.snapshot.ready ||
          state.initialized ||
          state.initializePromise
        ) {
          resetContactsStore(state);
        }
        return;
      }

      if (
        didReset ||
        subscriptionAvailabilityChanged ||
        !state.persistedDocumentsUnsubscribe
      ) {
        connectContactsStoreToPersistedDocuments(state);
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
    return existingStore;
  }

  const store = createContactsStore(runtime, dependencies);
  contactsStoresByScope.set(domainScope, store);
  return store;
}
