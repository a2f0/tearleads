import {
  type ContactEntryPatch,
  contactEntryToStructuredFieldPatch,
} from "../../document-types/contact/contactDocumentModel";
import type { ContactStoreOperationGuard } from "./contactStoreDuplicateSelfCleanup";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { resolveContactWriteTarget } from "./contactStoreRemoteCleanup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";

export async function writeContactPatch(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
  options: {
    readonly deferRemoteSync?: boolean | undefined;
    readonly guard?: ContactStoreOperationGuard | undefined;
    /** A contact this write creates opens with the patch as its birth. */
    readonly seedBirth?: boolean | undefined;
  } = {},
): Promise<void> {
  if (options.guard?.() === false) {
    return;
  }
  contactId = resolveContactWriteTarget(state, contactId);
  const fields = contactEntryToStructuredFieldPatch(patch);
  const store = ensureContactDocumentStore(state, contactId, {
    deferRemoteSync: options.deferRemoteSync,
    ...(options.seedBirth ? { initialFields: fields } : {}),
  });
  const snapshot = store.getSnapshot();
  if (snapshot.ready && !snapshot.canWrite) {
    return;
  }

  // A no-op after a seeded birth (equal values); applies to existing records.
  await store.setStructuredFields("contact", fields, {
    deferRemoteSync: options.deferRemoteSync,
  });
  if (options.guard?.() === false) {
    return;
  }
  const entry = contactEntryFromDocumentStore(contactId, store);
  if (entry) {
    upsertContactEntry(state, entry);
  }
}
