import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { removeContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  type ResolvedSelfContactIdentity,
  shouldRemoveDuplicateSelfContact,
} from "./selfContact";

export type ContactStoreOperationGuard = () => boolean;

type DuplicateSelfContactRemovalResult = "deleted" | "failed" | "stale";

async function deleteDuplicateSelfContact(input: {
  entry: ContactEntry;
  guard: ContactStoreOperationGuard;
  state: ContactsStoreState;
}): Promise<DuplicateSelfContactRemovalResult> {
  const { entry, guard, state } = input;
  const runtime = state.runtime;
  const trackedStore = state.contactDocumentStoresById.get(entry.id);
  const loadedDocument = await runtime.loadDocumentSummary(entry.id);
  if (!guard()) {
    return "stale";
  }

  const trackedDocumentId =
    trackedStore?.store.getSnapshot().documentId ?? null;
  const loadedDocumentId = loadedDocument?.documentId ?? null;
  const remoteDocumentId = loadedDocumentId ?? trackedDocumentId;
  const remoteIdentityMismatch =
    trackedDocumentId !== null &&
    loadedDocumentId !== null &&
    trackedDocumentId !== loadedDocumentId;
  if (remoteDocumentId) {
    if (
      !loadedDocument ||
      loadedDocument.documentId !== remoteDocumentId ||
      remoteIdentityMismatch ||
      !runtime.purgeDocument
    ) {
      state.dependencies.logError(
        `Contacts: cannot remove remotely synced duplicate self contact ${entry.id} without a matching purgeable document summary.`,
      );
      return "failed";
    }

    const purged = await runtime.purgeDocument(loadedDocument);
    if (!guard()) {
      return "stale";
    }
    if (!purged) {
      state.dependencies.logError(
        `Contacts: failed to purge duplicate self contact ${entry.id}.`,
      );
      return "failed";
    }
  }

  // A successful remote purge already removed the SQLite row. This second,
  // idempotent local delete also publishes the private projection-cache
  // invalidation used by Explorer; a never-synced fallback takes this path
  // directly.
  const deleted = await runtime.deleteDocument(entry.id);
  if (!guard()) {
    return "stale";
  }
  if (!deleted) {
    state.dependencies.logError(
      `Contacts: failed to delete duplicate self contact ${entry.id}.`,
    );
    return "failed";
  }

  trackedStore?.unsubscribe();
  state.contactDocumentStoresById.delete(entry.id);
  removeContactEntry(state, entry.id);
  return "deleted";
}

export async function removeDuplicateSelfContacts(
  state: ContactsStoreState,
  primaryContactId: string,
  identity: ResolvedSelfContactIdentity,
  guard: ContactStoreOperationGuard,
): Promise<void> {
  for (const entry of state.entriesById.values()) {
    if (!guard()) {
      return;
    }
    if (!shouldRemoveDuplicateSelfContact(entry, primaryContactId, identity)) {
      continue;
    }
    const removalResult = await deleteDuplicateSelfContact({
      entry,
      guard,
      state,
    });
    if (removalResult === "stale") {
      return;
    }
  }
}
