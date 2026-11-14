import type { DocumentStore } from "@tearleads/client-sdk";
import type { ContactAddressFields } from "../../document-types/contact/contactAddressModel";
import {
  addContactAddressRow,
  removeContactAddressRow,
  updateContactAddressRow,
} from "../documents/contactAddressWrites";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  captureContactsScope,
  contactsRuntimeWritable,
} from "./contactStoreWriteQueue";

async function mutateAddress<T>(
  state: ContactsStoreState,
  contactId: string,
  mutate: (store: DocumentStore, current: () => boolean) => Promise<T>,
  isCurrent: () => boolean = () => true,
): Promise<T> {
  const scoped = captureContactsScope(state);
  const current = () => scoped() && isCurrent();
  const result = state.writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!current() || !(await contactsRuntimeWritable(state)) || !current()) {
        throw new Error("Contact address scope is no longer writable.");
      }
      const store = await hydrateAddressTarget(state, contactId, current);
      if (!current() || !store.getSnapshot().canWrite) {
        throw new Error("Contact address target changed before saving.");
      }
      const result = await mutate(
        store,
        () =>
          current() &&
          state.entriesById.has(contactId) &&
          state.entriesById.get(contactId)?.canWrite !== false,
      );
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

async function hydrateAddressTarget(
  state: ContactsStoreState,
  contactId: string,
  current: () => boolean,
) {
  if (!current() || !state.entriesById.has(contactId))
    throw new Error("Contact not available.");
  const store = ensureContactDocumentStore(state, contactId);
  const ready = await store.ensureInitialized();
  if (!current())
    throw new Error("Contact address scope changed while loading.");
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
  return store;
}

export async function addContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  fields: ContactAddressFields,
  intent: object = {},
  isCurrent?: () => boolean,
): Promise<string | null> {
  return mutateAddress(
    state,
    contactId,
    (store, current) => addContactAddressRow(store, fields, intent, current),
    isCurrent,
  );
}

export async function updateContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  addressId: string,
  fields: Partial<ContactAddressFields>,
  isCurrent?: () => boolean,
): Promise<void> {
  await mutateAddress(
    state,
    contactId,
    (store, current) =>
      updateContactAddressRow(store, addressId, fields, current),
    isCurrent,
  );
}

export async function removeContactAddressInStore(
  state: ContactsStoreState,
  contactId: string,
  addressId: string,
  isCurrent?: () => boolean,
): Promise<void> {
  await mutateAddress(
    state,
    contactId,
    (store, current) => removeContactAddressRow(store, addressId, current),
    isCurrent,
  );
}
