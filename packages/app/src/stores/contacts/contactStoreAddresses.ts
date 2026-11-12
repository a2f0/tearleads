import type { DocumentStore } from "@tearleads/client-sdk";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  CONTACT_ADDRESS_ROW_TYPE,
  type ContactAddressFields,
  isContactAddressRow,
} from "../../document-types/contact/contactAddressModel";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { resolveContactWriteTarget } from "./contactStoreRemoteCleanup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  captureContactsScope,
  contactsRuntimeWritable,
} from "./contactStoreWriteQueue";

async function mutateAddress<T>(
  state: ContactsStoreState,
  contactId: string,
  mutate: (store: DocumentStore) => Promise<T>,
): Promise<T> {
  const current = captureAddressScope(state);
  contactId = resolveContactWriteTarget(state, contactId);
  const result = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!current() || !(await contactsRuntimeWritable(state)) || !current()) {
        throw new Error("Contact address scope is no longer writable.");
      }
      const target = await hydrateAddressTarget(state, contactId, current);
      const { store } = target;
      contactId = target.contactId;
      if (
        !current() ||
        !store.getSnapshot().canWrite ||
        resolveContactWriteTarget(state, contactId) !== contactId
      ) {
        throw new Error("Contact address target changed before saving.");
      }
      const result = await mutate(store);
      if (!current())
        throw new Error("Contact address scope changed while saving.");
      const entry = contactEntryFromDocumentStore(contactId, store);
      if (entry) upsertContactEntry(state, entry);
      return result;
    })
    .catch((error: unknown) => {
      state.dependencies.logError("Contacts: failed to save address.", error);
      throw error;
    });
  // Preserve rejection for the caller without poisoning the serialization tail.
  state.writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function captureAddressScope(state: ContactsStoreState): () => boolean {
  const scoped = captureContactsScope(state);
  const generation = state.initializationGeneration;
  const { auth, crypto, state: runtimeState } = state.runtime.documents;
  return () =>
    scoped() &&
    state.initializationGeneration === generation &&
    state.runtime.documents.auth.userId === auth.userId &&
    state.runtime.documents.auth.isAuthenticated === auth.isAuthenticated &&
    state.runtime.documents.crypto.signingFingerprint ===
      crypto.signingFingerprint &&
    state.runtime.documents.state.containerId === runtimeState.containerId &&
    state.runtime.documents.infra.dbStatus === "ready";
}

async function hydrateAddressTarget(
  state: ContactsStoreState,
  contactId: string,
  current: () => boolean,
) {
  for (;;) {
    contactId = resolveContactWriteTarget(state, contactId);
    if (!current() || !state.entriesById.has(contactId))
      throw new Error("Contact not available.");
    const store = ensureContactDocumentStore(state, contactId);
    const ready = await store.ensureInitialized();
    if (!current())
      throw new Error("Contact address scope changed while loading.");
    if (resolveContactWriteTarget(state, contactId) !== contactId) continue;
    const snapshot = store.getSnapshot();
    if (
      !ready ||
      !snapshot.ready ||
      !snapshot.canWrite ||
      snapshot.documentKind !== "contact" ||
      state.entriesById.get(contactId)?.canWrite === false
    ) {
      throw new Error("Contact addresses are not writable.");
    }
    return { contactId, store };
  }
}

function trimFields(
  fields: Partial<ContactAddressFields>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (
        !CONTACT_ADDRESS_FIELD_DESCRIPTORS.some((field) => field.key === key) ||
        typeof value !== "string"
      ) {
        throw new Error("Invalid contact address field.");
      }
      return [key, value.trim()];
    }),
  );
}

function requireAddress(store: DocumentStore, addressId: string) {
  const row = store.getSnapshot().rows.find((row) => row.id === addressId);
  if (!row || !isContactAddressRow(row))
    throw new Error("Contact address not found.");
  return row;
}

function requireSaved(store: DocumentStore, matches: boolean): void {
  // Row promises currently swallow SDK failures. A persisted snapshot plus no
  // unsaved local edits is necessary before acknowledging the UI's save.
  if (!matches || !store.getSnapshot().ready || store.hasUnsavedLocalEdits()) {
    throw new Error("Contact address changes were not saved.");
  }
}

export async function addContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  fields: ContactAddressFields,
): Promise<string | null> {
  const values = {
    ...trimFields(fields),
    recordType: CONTACT_ADDRESS_ROW_TYPE,
  };
  return mutateAddress(state, contactId, async (store) => {
    const id = await store.addRow(values);
    const row = store.getSnapshot().rows.find((row) => row.id === id);
    requireSaved(
      store,
      Boolean(
        row &&
          Object.entries(values).every(
            ([key, value]) => row.fields[key] === value,
          ),
      ),
    );
    return id;
  });
}

export async function updateContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  addressId: string,
  fields: Partial<ContactAddressFields>,
): Promise<void> {
  const values = trimFields(fields);
  await mutateAddress(state, contactId, async (store) => {
    const row = requireAddress(store, addressId);
    const patch = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => value !== (row.fields[key] ?? ""),
      ),
    );
    if (Object.keys(patch).length)
      await store.updateRowFields(addressId, patch);
    const saved = requireAddress(store, addressId);
    requireSaved(
      store,
      Object.entries(patch).every(
        ([key, value]) => saved.fields[key] === value,
      ),
    );
  });
}

export async function removeContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  addressId: string,
): Promise<void> {
  await mutateAddress(state, contactId, async (store) => {
    requireAddress(store, addressId);
    await store.removeRow(addressId);
    requireSaved(
      store,
      !store.getSnapshot().rows.some((row) => row.id === addressId),
    );
  });
}
