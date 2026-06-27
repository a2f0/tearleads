import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { sameContactEntry, sortContactEntries } from "./contactSnapshot";
import type { ContactsSnapshot, ContactsStoreState } from "./contactStoreTypes";

export function setContactsSnapshot(
  state: ContactsStoreState,
  next: ContactsSnapshot,
): void {
  if (
    state.snapshot.ready === next.ready &&
    state.snapshot.entries.length === next.entries.length &&
    state.snapshot.entries.every((entry, index) => {
      const nextEntry = next.entries[index];
      return nextEntry && sameContactEntry(entry, nextEntry);
    })
  ) {
    return;
  }

  state.snapshot = next;
  for (const listener of state.listeners) {
    listener();
  }
}

function flushContactsSnapshot(state: ContactsStoreState): void {
  state.pendingSnapshotFlush = false;
  setContactsSnapshot(state, {
    entries: sortContactEntries([...state.entriesById.values()]),
    ready: true,
  });
}

function scheduleContactsSnapshotFlush(state: ContactsStoreState): void {
  if (state.pendingSnapshotFlush) {
    return;
  }

  state.pendingSnapshotFlush = true;
  queueMicrotask(() => {
    if (state.pendingSnapshotFlush) {
      flushContactsSnapshot(state);
    }
  });
}

export function upsertContactEntry(
  state: ContactsStoreState,
  entry: ContactEntry,
): void {
  const existingEntry = state.entriesById.get(entry.id);
  if (existingEntry && sameContactEntry(existingEntry, entry)) {
    return;
  }

  state.entriesById.set(entry.id, entry);
  scheduleContactsSnapshotFlush(state);
}

export function removeContactEntry(
  state: ContactsStoreState,
  contactId: string,
): void {
  if (!state.entriesById.delete(contactId)) {
    return;
  }

  scheduleContactsSnapshotFlush(state);
}
