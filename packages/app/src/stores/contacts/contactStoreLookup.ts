import type {
  DocumentStore,
  ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import { getContactAvatarRef } from "../../document-types/contact/contactAvatarSlot";
import {
  type ContactEntry,
  contactFieldsToEntry,
  readContactFields,
} from "../../document-types/contact/contactDocumentModel";
import type { ContactsStoreState } from "./contactStoreTypes";

interface ContactKeyLookupDependencies {
  getLocalUserIdentity?:
    | ((userId: string) => Promise<ResolvedUserIdentity | null>)
    | undefined;
}

export function findContactByUserId(
  entriesById: ReadonlyMap<string, ContactEntry>,
  userId: string,
): ContactEntry | null {
  for (const entry of entriesById.values()) {
    if (entry.userId === userId) {
      return entry;
    }
  }

  return null;
}

export function findSelfContact(
  entriesById: ReadonlyMap<string, ContactEntry>,
  userId: string,
): ContactEntry | null {
  let selfContact: ContactEntry | null = null;
  for (const entry of entriesById.values()) {
    if (entry.userId === userId) {
      return entry;
    }
    if (entry.isSelf && !selfContact) {
      selfContact = entry;
    }
  }

  return selfContact;
}

export async function getUserIdentityForSelfContact(
  dependencies: ContactKeyLookupDependencies,
  userId: string,
): Promise<ResolvedUserIdentity | null> {
  // Self-contact maintenance participates in local bootstrap. The device's
  // own key material is sufficient; a missing key must not turn startup into
  // a network lookup. Explicit peer-key import owns remote resolution.
  return (await dependencies.getLocalUserIdentity?.(userId)) ?? null;
}

export function canWriteContactEntry(
  state: ContactsStoreState,
  contactId: string,
): boolean {
  const entry = state.entriesById.get(contactId);
  if (entry && entry.canWrite === false) {
    return false;
  }

  const trackedStore = state.contactDocumentStoresById.get(contactId);
  return trackedStore ? trackedStore.store.getSnapshot().canWrite : true;
}

export function contactEntryFromDocumentStore(
  contactId: string,
  store: DocumentStore,
): ContactEntry | null {
  const snapshot = store.getSnapshot();
  if (!snapshot.ready || snapshot.documentKind !== "contact") {
    return null;
  }

  return contactFieldsToEntry(
    contactId,
    readContactFields(snapshot.structuredFields),
    {
      avatar: getContactAvatarRef(
        snapshot.attachments,
        snapshot.attachmentStorageKeyBySlotId,
      ),
      canWrite: snapshot.canWrite,
    },
  );
}
