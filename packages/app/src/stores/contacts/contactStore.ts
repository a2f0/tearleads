import type { DomainScope } from "@tearleads/client-sdk";
import type { ContactEntryPatch } from "../../document-types/contact/contactDocumentModel";
import { createDocumentDraft } from "../documents/documentDraft";
import { TrashUnavailableError } from "../systemContainerTrash";
import { loadContactDocumentSummary } from "./contactDocumentSummary";
import {
  addContactAddressInStore,
  removeContactAddressInStore,
  updateContactAddressInStore,
} from "./contactStoreAddresses";
import {
  removeContactAvatarInStore,
  setContactAvatarInStore,
} from "./contactStoreAvatar";
import { writeContactPatch } from "./contactStoreFieldWrites";
import {
  ensureContactsInitialized,
  hasContactsContainerRuntime,
  resetContactsStore,
} from "./contactStoreInitialization";
import { findContactByUserId } from "./contactStoreLookup";
import { connectContactsStoreToPersistedDocuments } from "./contactStorePersistedDocuments";
import { ensureSelfContactFromRuntime } from "./contactStoreSelfContact";
import { removeContactEntry } from "./contactStoreSnapshotMutations";
import type {
  ContactRemovalOperation,
  ContactsRuntime,
  ContactsStore,
  ContactsStoreDependencies,
  ContactsStoreState,
} from "./contactStoreTypes";
import {
  captureContactsScope,
  contactsRuntimeWritable,
  queueContactWrite,
} from "./contactStoreWriteQueue";
import {
  type EnsureSelfContactInput,
  getSelfContactLocalId,
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

async function createContactFromRuntime(
  state: ContactsStoreState,
  patch: ContactEntryPatch,
): Promise<string | null> {
  const current = captureContactsScope(state);
  if (!(await contactsRuntimeWritable(state)) || !current()) return null;

  const contactId = createDocumentDraft({ documentKind: "contact" }).id;
  const saved = await queueContactWrite(
    state,
    "Contacts: failed to create contact.",
    () =>
      writeContactPatch(state, contactId, patch, {
        guard: current,
        seedBirth: true,
      }),
  );
  return saved ? contactId : null;
}

async function updateContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
): Promise<void> {
  const current = captureContactsScope(state);
  if (!(await contactsRuntimeWritable(state, contactId)) || !current()) return;

  await queueContactWrite(state, "Contacts: failed to update contact.", () =>
    writeContactPatch(state, contactId, patch, { guard: current }),
  );
}

async function importUserFromRuntime(
  state: ContactsStoreState,
  userId: string,
): Promise<string | null> {
  // Verify in, and later write to, this store's own database and identity.
  const current = captureContactsScope(state);
  const scope = state.runtime.documents.state.domainScope;
  const userIdentity = await state.dependencies.resolveVerified(userId, scope);
  if (!userIdentity || userIdentity.userId !== userId || !current()) {
    return null;
  }
  if (!(await contactsRuntimeWritable(state)) || !current()) return null;

  if (userId === state.runtime.documents.auth.userId) {
    if (
      userIdentity.signingKeyFingerprint !==
      state.runtime.documents.crypto.signingFingerprint
    ) {
      return null;
    }
    return ensureSelfContactFromRuntime(
      state,
      {
        encapsulationPublicKey: userIdentity.encapsulationPublicKey,
        localId: getSelfContactLocalId(userIdentity.signingKeyFingerprint),
        userId,
      },
      current,
    );
  }

  const contactId = await queueContactWrite(
    state,
    "Contacts: failed to import user key.",
    async () => {
      if (!current()) return null;
      const containerId = state.runtime.documents.state.containerId;
      if (!containerId) return null;
      // Peer imports remain idempotent within their own address book.
      const importedContactId =
        findContactByUserId(state.entriesById, userId)?.id ??
        `contact_v1_${containerId}_${userId}`;
      const saved = await writeContactPatch(
        state,
        importedContactId,
        {
          encapsulationPublicKey: userIdentity.encapsulationPublicKey,
          isSelf: false,
          userId,
        },
        { guard: current, seedBirth: true },
      );
      return saved ? importedContactId : null;
    },
  );
  return contactId ?? null;
}

async function removeContactFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  operation?: ContactRemovalOperation,
): Promise<void> {
  const scopeCurrent = captureContactsScope(state);
  const runtime = operation?.runtime ?? state.runtime;
  const isCurrent = () => scopeCurrent() && (operation?.isCurrent() ?? true);
  if (!(await contactsRuntimeWritable(state, contactId)) || !isCurrent()) {
    return;
  }

  await queueContactWrite(state, "Contacts: failed to remove contact.", () =>
    removeContactInCurrentScope(state, contactId, { runtime, isCurrent }),
  );
}

async function removeContactInCurrentScope(
  state: ContactsStoreState,
  contactId: string,
  { runtime, isCurrent }: ContactRemovalOperation,
): Promise<void> {
  if (!isCurrent()) return;
  const contactDocument = await loadContactDocumentSummary(runtime, contactId);
  if (!isCurrent()) return;
  if (!contactDocument) {
    state.dependencies.logError(
      `Contacts: failed to remove contact because document ${contactId} could not be loaded.`,
    );
    return;
  }

  // Resolve the Trash for the contact's OWN container (org-aware), lazily
  // provisioning the viewer's Trash when needed. Without a target the
  // contact stays in place — never a purge — and an unavailable Trash (a
  // fresh device before its root syncs) is reported rather than swallowed.
  const resolveTrashContainer = runtime.resolveTrashContainerForDocument;
  if (!resolveTrashContainer) return;
  const target = await resolveTrashContainer(contactDocument);
  if (!isCurrent()) return;
  if (target.status === "unavailable") {
    state.dependencies.logError(new TrashUnavailableError(target.reason));
    return;
  }
  if (target.status !== "target") return;

  const movedContact = await runtime.moveDocumentToTrash(
    contactDocument,
    target.trashContainerId,
  );
  if (!movedContact || !isCurrent()) return;

  const trackedStore = state.contactDocumentStoresById.get(contactId);
  trackedStore?.unsubscribe();
  state.contactDocumentStoresById.delete(contactId);
  removeContactEntry(state, contactId);
}

function updateContactsStoreRuntime(
  state: ContactsStoreState,
  runtime: ContactsRuntime,
): void {
  const previousDocuments = state.runtime.documents;
  if (
    previousDocuments.auth.userId !== runtime.documents.auth.userId ||
    previousDocuments.auth.organizationId !==
      runtime.documents.auth.organizationId ||
    previousDocuments.auth.isAuthenticated !==
      runtime.documents.auth.isAuthenticated ||
    previousDocuments.crypto.signingFingerprint !==
      runtime.documents.crypto.signingFingerprint
  ) {
    // Returning to the same keys after logout does not revive an old write.
    state.authorityGeneration += 1;
  }
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
    authorityGeneration: 0,
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
    addContactAddress: (contactId, fields, intent, isCurrent) =>
      addContactAddressInStore(state, contactId, fields, intent, isCurrent),
    updateContactAddress: (contactId, addressId, patch, isCurrent) =>
      updateContactAddressInStore(
        state,
        contactId,
        addressId,
        patch,
        isCurrent,
      ),
    removeContactAddress: (contactId, addressId, isCurrent) =>
      removeContactAddressInStore(state, contactId, addressId, isCurrent),
    createContact: (patch) => createContactFromRuntime(state, patch),
    ensureSelfContact: (input) => ensureSelfContactFromRuntime(state, input),
    getSnapshot: () => state.snapshot,
    importVerifiedUser: (userId) => importUserFromRuntime(state, userId),
    removeContact: (contactId, operation) =>
      removeContactFromRuntime(state, contactId, operation),
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
