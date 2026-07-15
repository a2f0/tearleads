import type {
  DocumentStore,
  ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import {
  type ContactEntry,
  contactFieldsToEntry,
  readContactFields,
} from "../../document-types/contact/contactDocumentModel";

interface ContactKeyLookupDependencies {
  resolveUserIdentity: (userId: string) => Promise<ResolvedUserIdentity | null>;
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
  const localUserIdentity = await dependencies.getLocalUserIdentity?.(userId);
  return localUserIdentity ?? dependencies.resolveUserIdentity(userId);
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
