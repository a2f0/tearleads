import {
  type ContactEntryPatch,
  contactEntryToStructuredFieldPatch,
} from "../../document-types/contact/contactDocumentModel";
import { ensureContactDocumentStore } from "./contactStoreInitialization";
import { contactEntryFromDocumentStore } from "./contactStoreLookup";
import { upsertContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";

export async function writeContactPatch(
  state: ContactsStoreState,
  contactId: string,
  patch: ContactEntryPatch,
  options: {
    readonly deferRemoteSync?: boolean | undefined;
    readonly guard?: (() => boolean) | undefined;
    /** A contact this write creates opens with the patch as its birth. */
    readonly seedBirth?: boolean | undefined;
  } = {},
): Promise<boolean> {
  if (options.guard?.() === false) {
    return false;
  }
  const fields = contactEntryToStructuredFieldPatch(patch);
  const store = ensureContactDocumentStore(state, contactId, {
    deferRemoteSync: options.deferRemoteSync,
    ...(options.seedBirth ? { initialFields: fields } : {}),
  });
  const ready = await store.ensureInitialized();
  if (!ready || options.guard?.() === false) return false;
  const snapshot = store.getSnapshot();
  if (!snapshot.ready || !snapshot.canWrite) {
    return false;
  }

  // A no-op after a seeded birth (equal values); applies to existing records.
  await store.setStructuredFields("contact", fields, {
    deferRemoteSync: options.deferRemoteSync,
    stillCurrent: options.guard,
  });
  if (options.guard?.() === false) {
    return false;
  }
  const entry = contactEntryFromDocumentStore(contactId, store);
  const saved = store.getSnapshot();
  if (
    !entry ||
    !saved.canWrite ||
    store.hasUnsavedLocalEdits() ||
    !Object.entries(fields).every(
      ([key, value]) => (saved.structuredFields[key] ?? "") === (value ?? ""),
    )
  ) {
    return false;
  }
  upsertContactEntry(state, entry);
  return true;
}
