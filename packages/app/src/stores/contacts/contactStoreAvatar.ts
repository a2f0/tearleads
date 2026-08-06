import type {
  DocumentAttachmentUpload,
  DocumentStore,
} from "@tearleads/client-sdk";
import { CONTACT_AVATAR_SLOT_ID } from "../../document-types/contact/contactAvatarSlot";
import {
  ensureContactDocumentStore,
  hasContactsContainerRuntime,
  waitForContactsInitialization,
} from "./contactStoreInitialization";
import {
  canWriteContactEntry,
  contactEntryFromDocumentStore,
} from "./contactStoreLookup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";

// The avatar is an attachment slot on the contact document, so it mutates
// through the document store's attachment API rather than a structured-field
// patch. The attachment write itself is fire-and-forget (the document store
// queues persistence and upload internally); the per-contact subscription
// re-projects the entry once the snapshot reflects the new binding.
async function mutateContactAvatarFromRuntime(
  state: ContactsStoreState,
  contactId: string,
  mutateAvatar: (store: DocumentStore) => void,
  errorMessage: string,
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
    .then(() => {
      const store = ensureContactDocumentStore(state, contactId);
      const snapshot = store.getSnapshot();
      if (snapshot.ready && !snapshot.canWrite) {
        return;
      }
      mutateAvatar(store);
      const entry = contactEntryFromDocumentStore(contactId, store);
      if (entry) {
        upsertContactEntry(state, entry);
      }
    })
    .catch((error: unknown) => {
      state.dependencies.logError(errorMessage, error);
    });
  await state.writeChain;
}

export function setContactAvatarInStore(
  state: ContactsStoreState,
  contactId: string,
  upload: DocumentAttachmentUpload,
): Promise<void> {
  return mutateContactAvatarFromRuntime(
    state,
    contactId,
    (store) => store.replaceAttachment(CONTACT_AVATAR_SLOT_ID, upload),
    "Contacts: failed to set contact avatar.",
  );
}

export function removeContactAvatarInStore(
  state: ContactsStoreState,
  contactId: string,
): Promise<void> {
  return mutateContactAvatarFromRuntime(
    state,
    contactId,
    (store) => store.removeAttachment(CONTACT_AVATAR_SLOT_ID),
    "Contacts: failed to remove contact avatar.",
  );
}
