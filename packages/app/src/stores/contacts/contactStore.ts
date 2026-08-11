import type { DomainScope } from "@tearleads/client-sdk";
import {
  type ContactEntry,
  type ContactEntryPatch,
  contactEntryToStructuredFieldPatch,
} from "../../document-types/contact/contactDocumentModel";
import { loadContactDocumentSummary } from "./contactDocumentSummary";
import {
  removeContactAvatarInStore,
  setContactAvatarInStore,
} from "./contactStoreAvatar";
import {
  type ContactStoreOperationGuard,
  removeDuplicateSelfContacts,
} from "./contactStoreDuplicateSelfCleanup";
import {
  ensureContactDocumentStore,
  ensureContactsInitialized,
  hasContactsContainerRuntime,
  resetContactsStore,
} from "./contactStoreInitialization";
import {
  createLateSelfContactReconciliation,
  hydrateLateSelfContactFallback,
} from "./contactStoreLateSelfReconciliation";
import {
  contactEntryFromDocumentStore,
  findContactByUserId,
  findSelfContact,
  getUserIdentityForSelfContact,
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
  contactsRuntimeWritable,
  queueContactWrite,
} from "./contactStoreWriteQueue";
import {
  type EnsureSelfContactInput,
  findPrimarySelfContact,
  getSelfContactLocalId,
  isSelfContactCurrent,
  type ResolvedSelfContactIdentity,
  resolveSelfContactId,
  toResolvedSelfContactIdentity,
} from "./selfContact";

export type { ContactsRuntime, ContactsStore, EnsureSelfContactInput };
export { getSelfContactLocalId };

// Multiple mini-apps can stay mounted while Org Manager switches the active
// organization. Isolate their mutable runtimes so a missing foreign Contacts
// container cannot reset the personal organization's projected contacts.
const contactsStoresByScope = new WeakMap<
  DomainScope,
  Map<string | null, ContactsStore>
>();
const allowContactStoreOperation = () => true;

async function writeContactPatch(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
  options: {
    readonly deferRemoteSync?: boolean | undefined;
    readonly guard?: ContactStoreOperationGuard | undefined;
  } = {},
): Promise<void> {
  const guard = options.guard ?? allowContactStoreOperation;
  if (!guard()) {
    return;
  }
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
  if (!guard()) {
    return;
  }
  const entry = contactEntryFromDocumentStore(contactId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}

async function createContactFromRuntime(
  state: ContactsStoreState,
  patch: ContactEntryPatch,
): Promise<string | null> {
  if (!(await contactsRuntimeWritable(state))) {
    return null;
  }

  const contactId = crypto.randomUUID();
  await queueContactWrite(state, "Contacts: failed to create contact.", () =>
    writeContactPatch(state, contactId, patch),
  );
  return contactId;
}

async function resolveSelfContactIdentity(
  state: ContactsStoreState,
  input: EnsureSelfContactInput,
): Promise<ResolvedSelfContactIdentity | null> {
  if (input.userId && !input.encapsulationPublicKey?.trim()) {
    const userIdentity = await getUserIdentityForSelfContact(
      state.dependencies,
      input.userId,
    );
    return userIdentity
      ? toResolvedSelfContactIdentity(input, userIdentity)
      : null;
  }

  return toResolvedSelfContactIdentity(input);
}

async function ensureSelfContactFromRuntime(
  state: ContactsStoreState,
  input: EnsureSelfContactInput,
  guard: ContactStoreOperationGuard = allowContactStoreOperation,
): Promise<string | null> {
  if (!(await contactsRuntimeWritable(state)) || !guard()) {
    return null;
  }

  const identity = await resolveSelfContactIdentity(state, input);
  if (!guard() || !identity) {
    return null;
  }

  const existingContact = findPrimarySelfContact(
    state.entriesById,
    identity,
    input.lookupUserId,
  );
  const contactId = resolveSelfContactId(existingContact, identity);
  if (!contactId) {
    return null;
  }
  const deferRemoteSync = input.deferRemoteSync === true;
  // A signed-out bootstrap only knows the deterministic device-local id. If
  // that id already belongs to a self contact promoted while authenticated,
  // preserve its remote identity instead of replacing the user id and public
  // key with nulls and leaving a spurious deferred edit behind on logout.
  const preservesExistingRemoteIdentity =
    deferRemoteSync &&
    identity.userId === null &&
    identity.encapsulationPublicKey === null &&
    existingContact?.isSelf === true;
  const current =
    preservesExistingRemoteIdentity ||
    isSelfContactCurrent(existingContact, identity);
  if (!guard()) {
    return null;
  }

  await queueContactWrite(
    state,
    "Contacts: failed to ensure self contact.",
    async () => {
      if (!guard()) {
        return;
      }
      if (!current || !deferRemoteSync) {
        await removeDuplicateSelfContacts(state, contactId, identity, guard);
        if (!guard()) {
          return;
        }
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
            guard,
          },
        );
        return;
      }
      await removeDuplicateSelfContacts(state, contactId, identity, guard);
    },
  );
  return contactId;
}

async function reconcileLatePersistedSelfContact(
  state: ContactsStoreState,
  entry: ContactEntry,
): Promise<void> {
  const reconciliation = createLateSelfContactReconciliation(state, entry);
  if (!reconciliation) {
    return;
  }
  await hydrateLateSelfContactFallback(state, reconciliation);

  await ensureSelfContactFromRuntime(
    state,
    reconciliation.input,
    reconciliation.canApply,
  );
}

async function updateContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
): Promise<void> {
  if (!(await contactsRuntimeWritable(state, contactId))) {
    return;
  }

  await queueContactWrite(state, "Contacts: failed to update contact.", () =>
    writeContactPatch(state, contactId, patch),
  );
}

async function importKeyFromRuntime(
  state: ContactsStoreState,
  userId: string,
): Promise<string | null> {
  const userIdentity = await state.dependencies.resolveUserIdentity(userId);
  if (!userIdentity) {
    return null;
  }

  if (!(await contactsRuntimeWritable(state))) {
    return null;
  }

  const isSelf = userIdentity.userId === state.runtime.documents.auth.userId;
  const existingContact = isSelf
    ? findSelfContact(state.entriesById, userIdentity.userId)
    : findContactByUserId(state.entriesById, userIdentity.userId);
  const contactId = existingContact?.id ?? userIdentity.userId;
  await queueContactWrite(
    state,
    "Contacts: failed to import user key.",
    async () => {
      const identity = toResolvedSelfContactIdentity({
        encapsulationPublicKey: userIdentity.encapsulationPublicKey,
        userId: userIdentity.userId,
      });
      await writeContactPatch(state, contactId, {
        encapsulationPublicKey: userIdentity.encapsulationPublicKey,
        isSelf,
        userId: userIdentity.userId,
      });
      if (isSelf && identity) {
        await removeDuplicateSelfContacts(
          state,
          contactId,
          identity,
          allowContactStoreOperation,
        );
      }
    },
  );
  return contactId;
}

async function removeContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
): Promise<void> {
  if (!(await contactsRuntimeWritable(state, contactId))) {
    return;
  }

  await queueContactWrite(
    state,
    "Contacts: failed to remove contact.",
    async () => {
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

      // Resolve the Trash for the contact's OWN container (org-aware), lazily
      // provisioning the viewer's Trash when needed. A null result means there is
      // nowhere to move it, so leave the contact in place — a no-op, not a purge.
      const resolveTrashContainer =
        state.runtime.resolveTrashContainerForDocument;
      const trashContainerId = resolveTrashContainer
        ? await resolveTrashContainer(contactDocument)
        : null;
      if (!trashContainerId) {
        return;
      }

      const movedContact = await state.runtime.moveDocumentToTrash(
        contactDocument,
        trashContainerId,
      );
      if (!movedContact) {
        return;
      }

      const trackedStore = state.contactDocumentStoresById.get(contactId);
      trackedStore?.unsubscribe();
      state.contactDocumentStoresById.delete(contactId);
      removeContactEntry(state, contactId);
    },
  );
}

function updateContactsStoreRuntime(
  state: ContactsStoreState,
  runtime: ContactsRuntime,
): void {
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
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
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
    onContactEntry: (entry) => {
      void reconcileLatePersistedSelfContact(state, entry).catch(
        (error: unknown) => {
          state.dependencies.logError(
            "Contacts: failed to reconcile a hydrated self contact.",
            error,
          );
        },
      );
    },
    pendingSnapshotFlush: false,
    persistedDocumentsUnsubscribe: null,
    runtime: initialRuntime,
    snapshot: { entries: [], ready: false },
    writeChain: Promise.resolve(),
  };
  connectContactsStoreToPersistedDocuments(state);

  return {
    createContact: (patch) => createContactFromRuntime(state, patch),
    ensureSelfContact: (input) => ensureSelfContactFromRuntime(state, input),
    getSnapshot: () => state.snapshot,
    importKey: (userId) => importKeyFromRuntime(state, userId),
    removeContact: (contactId) => removeContactFromRuntime(state, contactId),
    removeContactAvatar: (contactId) =>
      removeContactAvatarInStore(state, contactId),
    setContactAvatar: (contactId, upload) =>
      setContactAvatarInStore(state, contactId, upload),
    subscribe(listener) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    updateContact: (contactId, patch) =>
      updateContactFromRuntime(state, contactId, patch),
    updateRuntime: (runtime) => updateContactsStoreRuntime(state, runtime),
  };
}

export function getOrCreateContactsStore(
  domainScope: DomainScope,
  runtime: ContactsRuntime,
  dependencies: ContactsStoreDependencies,
): ContactsStore {
  let storesByContainerId = contactsStoresByScope.get(domainScope);
  if (!storesByContainerId) {
    storesByContainerId = new Map();
    contactsStoresByScope.set(domainScope, storesByContainerId);
  }
  const containerId = runtime.documents.state.containerId ?? null;
  const existingStore = storesByContainerId.get(containerId);
  if (existingStore) {
    return existingStore;
  }

  const store = createContactsStore(runtime, dependencies);
  storesByContainerId.set(containerId, store);
  return store;
}
