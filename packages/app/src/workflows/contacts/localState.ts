import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import type { ContactEntry } from "../../data/contacts/addressBookEntry";
import {
  type ContactDocument,
  getContactEntryValue,
  setContactEntryValue,
} from "../../data/contacts/contactDocument";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import { createPendingUpdateFields } from "../../data/documentSync";
import type { ContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
import {
  type ContactDocumentState,
  type ContactDocumentSyncRuntime,
  persistContactDocumentState,
} from "./sync";

const CONTACTS_PEER_SEED_SCOPE = "contacts";

type StoredContact = Awaited<
  ReturnType<ContactsPersistence["loadContacts"]>
>[number];
export type ContactLocalStateRuntime = Pick<
  ContactDocumentSyncRuntime,
  "execSql"
>;

function resolveContactsAddressBookId(addressBookId?: string | null) {
  return addressBookId ?? DEFAULT_CONTACTS_ADDRESS_BOOK_ID;
}

async function createContactDocument() {
  return createDocument(getScopedPeerSeed(CONTACTS_PEER_SEED_SCOPE));
}

async function cloneContactDocument(doc: ContactDocument) {
  const nextDoc = await createContactDocument();
  importUpdates(nextDoc, [exportAllUpdates(doc)]);
  return nextDoc;
}

function createInitialContactRecord(input: {
  contactId: string;
  initialUpdate: Uint8Array;
}): DocumentRecord {
  return {
    id: input.contactId,
    documentId: null,
    loroSnapshot: bytesToBase64(input.initialUpdate),
    accessEpoch: 1,
    accessStateHash: null,
    lastCommitLsn: null,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
}

async function enqueueContactPendingUpdate(input: {
  contactId: string;
  execSql: ExecSql;
  persistence: ContactsPersistence;
  sourceVersionVector?: string | null;
  update: Uint8Array;
}) {
  const pendingUpdateFields = createPendingUpdateFields(
    input.update,
    input.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await input.persistence.enqueuePendingUpdate(input.execSql, {
    contactId: input.contactId,
    ...pendingUpdateFields,
  });
}

function sameContactEntry(left: ContactEntry, right: ContactEntry): boolean {
  return (
    left.id === right.id &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.userId === right.userId &&
    left.encapsulationPublicKey === right.encapsulationPublicKey &&
    left.isSelf === right.isSelf
  );
}

async function hydrateStoredContactState(input: {
  addressBookId: string;
  execSql: ExecSql;
  persistence: ContactsPersistence;
  storedContact: StoredContact;
}): Promise<ContactDocumentState> {
  const { addressBookId, execSql, persistence, storedContact } = input;
  const doc = await createContactDocument();
  const record = storedContact.record;

  if (record?.loroSnapshot) {
    importUpdates(doc, [base64ToBytes(record.loroSnapshot)]);
    return {
      doc,
      entry: getContactEntryValue(
        storedContact.entry.id,
        doc,
        storedContact.entry.isSelf,
      ),
      record,
    };
  }

  setContactEntryValue(doc, storedContact.entry);
  const initialUpdate = exportAllUpdates(doc);
  const nextRecord = createInitialContactRecord({
    contactId: storedContact.entry.id,
    initialUpdate,
  });

  await enqueueContactPendingUpdate({
    contactId: storedContact.entry.id,
    execSql,
    persistence,
    update: initialUpdate,
  });
  await persistence.saveContact(
    execSql,
    addressBookId,
    nextRecord,
    storedContact.entry,
  );

  return {
    doc,
    entry: storedContact.entry,
    record: nextRecord,
  };
}

async function loadStoredContactDocumentStates(input: {
  addressBookId: string;
  execSql: ExecSql;
  persistence: ContactsPersistence;
}): Promise<ContactDocumentState[]> {
  const { addressBookId, execSql, persistence } = input;
  await persistence.ensureSchema(execSql);
  const storedContacts = await persistence.loadContacts(execSql, addressBookId);

  return Promise.all(
    storedContacts.map((storedContact) =>
      hydrateStoredContactState({
        addressBookId,
        execSql,
        persistence,
        storedContact,
      }),
    ),
  );
}

export function loadContactDocumentStates(input: {
  addressBookId?: string | null;
  persistence: ContactsPersistence;
  runtime: ContactLocalStateRuntime;
}): Promise<ContactDocumentState[]> {
  return loadStoredContactDocumentStates({
    addressBookId: resolveContactsAddressBookId(input.addressBookId),
    execSql: input.runtime.execSql,
    persistence: input.persistence,
  });
}

export async function persistContactEntry(input: {
  addressBookId: string;
  entry: ContactEntry;
  execSql: ExecSql;
  existingContact?: ContactDocumentState | null | undefined;
  persistence: ContactsPersistence;
}): Promise<{ changed: boolean; contact: ContactDocumentState }> {
  const { addressBookId, entry, execSql, existingContact, persistence } = input;

  if (existingContact && sameContactEntry(existingContact.entry, entry)) {
    return { changed: false, contact: existingContact };
  }

  if (existingContact && existingContact.entry.id !== entry.id) {
    throw new Error("Cannot change a contact entry id.");
  }

  if (!existingContact) {
    const doc = await createContactDocument();
    setContactEntryValue(doc, entry);
    const initialUpdate = exportAllUpdates(doc);
    const contact: ContactDocumentState = {
      doc,
      entry,
      record: createInitialContactRecord({
        contactId: entry.id,
        initialUpdate,
      }),
    };

    await enqueueContactPendingUpdate({
      contactId: entry.id,
      execSql,
      persistence,
      update: initialUpdate,
    });
    contact.record = await persistContactDocumentState({
      addressBookId,
      contact,
      execSql,
      persistence,
    });

    return { changed: true, contact };
  }

  const previousVersion = encodeVersionVector(existingContact.doc);
  const nextDoc = await cloneContactDocument(existingContact.doc);
  setContactEntryValue(nextDoc, entry);
  const nextContact: ContactDocumentState = {
    ...existingContact,
    doc: nextDoc,
    entry,
  };
  await enqueueContactPendingUpdate({
    contactId: entry.id,
    execSql,
    persistence,
    update: exportUpdatesSince(nextDoc, previousVersion),
  });
  nextContact.record = await persistContactDocumentState({
    addressBookId,
    contact: nextContact,
    execSql,
    persistence,
  });

  return { changed: true, contact: nextContact };
}

export function persistContactEntryFromRuntime(input: {
  addressBookId?: string | null;
  entry: ContactEntry;
  existingContact?: ContactDocumentState | null | undefined;
  persistence: ContactsPersistence;
  runtime: ContactLocalStateRuntime;
}): Promise<{ changed: boolean; contact: ContactDocumentState }> {
  return persistContactEntry({
    addressBookId: resolveContactsAddressBookId(input.addressBookId),
    entry: input.entry,
    execSql: input.runtime.execSql,
    existingContact: input.existingContact,
    persistence: input.persistence,
  });
}

async function deleteContactEntry(input: {
  addressBookId: string;
  contactId: string;
  execSql: ExecSql;
  persistence: ContactsPersistence;
}) {
  await input.persistence.deleteContact(
    input.execSql,
    input.addressBookId,
    input.contactId,
  );
}

export function deleteContactEntryFromRuntime(input: {
  addressBookId?: string | null;
  contactId: string;
  persistence: ContactsPersistence;
  runtime: ContactLocalStateRuntime;
}): Promise<void> {
  return deleteContactEntry({
    addressBookId: resolveContactsAddressBookId(input.addressBookId),
    contactId: input.contactId,
    execSql: input.runtime.execSql,
    persistence: input.persistence,
  });
}
