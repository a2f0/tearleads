import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  ensureContactDocumentStore,
  waitForContactsInitialization,
} from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import {
  removeContactEntry,
  upsertContactEntry,
} from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";

function connectPersistedContactDocuments(input: {
  readonly getContactsContainerId: () => string | null;
  readonly onPersistedContact: (
    contactId: string,
    persistedContainerId: string | null,
  ) => void;
  readonly subscribe:
    | ((listener: (document: DocumentSummary) => void) => () => void)
    | undefined;
}): (() => void) | null {
  if (!input.subscribe) {
    return null;
  }

  return input.subscribe((document) => {
    if (
      document.documentKind !== "contact" ||
      !input.getContactsContainerId()
    ) {
      return;
    }

    input.onPersistedContact(document.id, document.containerId ?? null);
  });
}

async function applyPersistedContactDocument(
  state: ContactsStoreState,
  contactId: string,
  persistedContainerId: string | null,
): Promise<void> {
  await waitForContactsInitialization(state);
  const contactsContainerId = state.runtime.documents.state.containerId;
  if (!contactsContainerId) {
    return;
  }

  if (persistedContainerId !== contactsContainerId) {
    const trackedStore = state.contactDocumentStoresById.get(contactId);
    trackedStore?.unsubscribe();
    state.contactDocumentStoresById.delete(contactId);
    removeContactEntry(state, contactId);
    return;
  }

  const store = ensureContactDocumentStore(state, contactId);
  const entry = contactEntryFromDocumentStore(contactId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}

export function connectContactsStoreToPersistedDocuments(
  state: ContactsStoreState,
): void {
  connectPersistedContactDocuments({
    getContactsContainerId: () =>
      state.runtime.documents.state.containerId ?? null,
    onPersistedContact: (contactId, persistedContainerId) => {
      void applyPersistedContactDocument(
        state,
        contactId,
        persistedContainerId,
      ).catch((error: unknown) => {
        state.dependencies.logError(
          "Contacts: failed to apply a persisted contact.",
          error,
        );
      });
    },
    subscribe: state.runtime.subscribeToPersistedDocuments,
  });
}
