import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  ensureContactDocumentStore,
  hasContactsContainerRuntime,
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
  generation: number,
  isSubscriptionActive: () => boolean,
  persistedContainerId: string | null,
): Promise<void> {
  await waitForContactsInitialization(state);
  if (
    !isSubscriptionActive() ||
    state.initializationGeneration !== generation
  ) {
    return;
  }
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
    state.onContactEntry(entry);
  }
}

export function connectContactsStoreToPersistedDocuments(
  state: ContactsStoreState,
): void {
  state.persistedDocumentsUnsubscribe?.();
  state.persistedDocumentsUnsubscribe = null;
  if (
    state.runtime.documents.infra.dbStatus !== "ready" ||
    !hasContactsContainerRuntime(state)
  ) {
    return;
  }

  const generation = state.initializationGeneration;
  let active = true;
  const unsubscribe = connectPersistedContactDocuments({
    getContactsContainerId: () =>
      state.runtime.documents.state.containerId ?? null,
    onPersistedContact: (contactId, persistedContainerId) => {
      if (!active) {
        return;
      }
      void applyPersistedContactDocument(
        state,
        contactId,
        generation,
        () => active,
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
  if (!unsubscribe) {
    active = false;
    return;
  }
  state.persistedDocumentsUnsubscribe = () => {
    if (!active) {
      return;
    }
    active = false;
    unsubscribe();
  };
}
