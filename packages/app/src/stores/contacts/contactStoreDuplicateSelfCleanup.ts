import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { scheduleRemoteContactCleanup } from "./contactStoreRemoteCleanup";
import { removeContactEntry } from "./contactStoreSnapshotMutations";
import type { ContactsStoreState } from "./contactStoreTypes";
import {
  type ResolvedSelfContactIdentity,
  shouldRemoveDuplicateSelfContact,
} from "./selfContact";

export type ContactStoreOperationGuard = () => boolean;

type DuplicateSelfContactRemovalResult =
  | "deleted"
  | "deferred"
  | "failed"
  | "stale";

async function deleteDuplicateSelfContact(input: {
  entry: ContactEntry;
  guard: ContactStoreOperationGuard;
  primaryContactId: string;
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

    let purgeAcknowledged = false;
    scheduleRemoteContactCleanup({
      current: guard,
      localId: entry.id,
      replacementLocalId: input.primaryContactId,
      state,
      run: async () => {
        const currentRuntime = state.runtime;
        const summary = await currentRuntime.loadDocumentSummary(entry.id);
        const trackedId = state.contactDocumentStoresById
          .get(entry.id)
          ?.store.getSnapshot().documentId;
        if (
          !guard() ||
          (summary
            ? summary.documentId !== remoteDocumentId
            : !purgeAcknowledged) ||
          (trackedId && trackedId !== remoteDocumentId)
        ) {
          return false;
        }
        if (!purgeAcknowledged) {
          if (
            !summary ||
            !currentRuntime.purgeDocument ||
            !(await currentRuntime.purgeDocument(summary))
          )
            return false;
          // Purge removes the durable row. A local failure must retry settlement
          // without requiring that row, while still rejecting a new identity.
          purgeAcknowledged = true;
        }
        if (!guard()) return false;
        // Only local settlement joins the write queue. A queued edit gets its
        // turn first and the duplicate guard is rechecked before deletion.
        const deletion = state.writeChain
          .catch(() => undefined)
          .then(
            async () =>
              guard() &&
              (await deleteLocalDuplicateSelfContact({
                entry,
                guard,
                state,
              })) === "deleted",
          );
        state.writeChain = deletion.then(
          () => undefined,
          () => undefined,
        );
        return deletion;
      },
    });
    return "deferred";
  }

  return deleteLocalDuplicateSelfContact(input);
}

async function deleteLocalDuplicateSelfContact(input: {
  entry: ContactEntry;
  guard: ContactStoreOperationGuard;
  state: ContactsStoreState;
}): Promise<DuplicateSelfContactRemovalResult> {
  const { entry, guard, state } = input;
  const runtime = state.runtime;
  const trackedStore = state.contactDocumentStoresById.get(entry.id);

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
  const generation = state.initializationGeneration;
  const userId = state.runtime.documents.auth.userId;
  const signingFingerprint = state.runtime.documents.crypto.signingFingerprint;
  for (const entry of state.entriesById.values()) {
    if (!guard()) {
      return;
    }
    if (!shouldRemoveDuplicateSelfContact(entry, primaryContactId, identity)) {
      continue;
    }
    const removalResult = await deleteDuplicateSelfContact({
      entry,
      primaryContactId,
      guard: () => {
        const currentEntry = state.entriesById.get(entry.id);
        return (
          guard() &&
          state.initializationGeneration === generation &&
          state.runtime.documents.auth.userId === userId &&
          state.runtime.documents.crypto.signingFingerprint ===
            signingFingerprint &&
          currentEntry !== undefined &&
          shouldRemoveDuplicateSelfContact(
            currentEntry,
            primaryContactId,
            identity,
          )
        );
      },
      state,
    });
    if (removalResult === "stale") {
      return;
    }
  }
}
