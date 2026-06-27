import type { DocumentStore, UserKey } from "@tearleads/client-sdk";
import {
  type ContactEntry,
  contactFieldsToEntry,
  readContactFields,
} from "../../document-types/contact/contactDocumentModel";

interface ContactKeyLookupDependencies {
  fetchUserKey: (userId: string) => Promise<UserKey | null>;
  getLocalUserKey?: ((userId: string) => Promise<UserKey | null>) | undefined;
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

export async function getUserKeyForSelfContact(
  dependencies: ContactKeyLookupDependencies,
  userId: string,
): Promise<UserKey | null> {
  const localUserKey = await dependencies.getLocalUserKey?.(userId);
  return localUserKey ?? dependencies.fetchUserKey(userId);
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
    { canWrite: snapshot.canWrite },
  );
}
