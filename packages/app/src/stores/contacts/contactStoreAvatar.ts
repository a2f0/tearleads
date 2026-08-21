import type {
  DocumentAttachmentUpload,
  DocumentStore,
} from "@symcrypt/client-sdk";
import { CONTACT_AVATAR_SLOT_ID } from "../../document-types/contact/contactAvatarSlot";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  contactsRuntimeWritable,
  queueContactWrite,
} from "./contactStoreWriteQueue";

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
  if (!(await contactsRuntimeWritable(state, contactId))) {
    return;
  }

  await queueContactWrite(state, errorMessage, () => {
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
  });
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
