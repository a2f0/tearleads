import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
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
  initialUpdate: Uint8Array;
  userId: string;
}): DocumentRecord {
  return {
    id: input.userId,
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
  execSql: ExecSql;
  persistence: ContactsPersistence;
  sourceVersionVector?: string | null;
  update: Uint8Array;
  userId: string;
}) {
  const pendingUpdateFields = createPendingUpdateFields(
    input.update,
    input.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await input.persistence.enqueuePendingUpdate(input.execSql, {
    userId: input.userId,
    ...pendingUpdateFields,
  });
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
      entry:
        getContactEntryValue(
          storedContact.entry.userId,
          doc,
          storedContact.entry.isSelf,
        ) ?? storedContact.entry,
      record,
    };
  }

  setContactEntryValue(doc, storedContact.entry);
  const initialUpdate = exportAllUpdates(doc);
  const nextRecord = createInitialContactRecord({
    initialUpdate,
    userId: storedContact.entry.userId,
  });

  await enqueueContactPendingUpdate({
    execSql,
    persistence,
    update: initialUpdate,
    userId: storedContact.entry.userId,
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

export async function persistImportedContactEntry(input: {
  addressBookId: string;
  entry: AddressBookEntry;
  execSql: ExecSql;
  existingContact?: ContactDocumentState | null | undefined;
  persistence: ContactsPersistence;
}): Promise<{ changed: boolean; contact: ContactDocumentState }> {
  const { addressBookId, entry, execSql, existingContact, persistence } = input;

  if (
    existingContact &&
    existingContact.entry.encapsulationPublicKey ===
      entry.encapsulationPublicKey &&
    existingContact.entry.isSelf === entry.isSelf
  ) {
    return { changed: false, contact: existingContact };
  }

  if (!existingContact) {
    const doc = await createContactDocument();
    setContactEntryValue(doc, entry);
    const initialUpdate = exportAllUpdates(doc);
    const contact: ContactDocumentState = {
      doc,
      entry,
      record: createInitialContactRecord({
        initialUpdate,
        userId: entry.userId,
      }),
    };

    await enqueueContactPendingUpdate({
      execSql,
      persistence,
      update: initialUpdate,
      userId: entry.userId,
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
    execSql,
    persistence,
    update: exportUpdatesSince(nextDoc, previousVersion),
    userId: entry.userId,
  });
  nextContact.record = await persistContactDocumentState({
    addressBookId,
    contact: nextContact,
    execSql,
    persistence,
  });

  return { changed: true, contact: nextContact };
}

export function persistImportedContactEntryFromRuntime(input: {
  addressBookId?: string | null;
  entry: AddressBookEntry;
  existingContact?: ContactDocumentState | null | undefined;
  persistence: ContactsPersistence;
  runtime: ContactLocalStateRuntime;
}): Promise<{ changed: boolean; contact: ContactDocumentState }> {
  return persistImportedContactEntry({
    addressBookId: resolveContactsAddressBookId(input.addressBookId),
    entry: input.entry,
    execSql: input.runtime.execSql,
    existingContact: input.existingContact,
    persistence: input.persistence,
  });
}

async function deleteContactEntry(input: {
  addressBookId: string;
  execSql: ExecSql;
  persistence: ContactsPersistence;
  userId: string;
}) {
  await input.persistence.deleteContact(
    input.execSql,
    input.addressBookId,
    input.userId,
  );
}

export function deleteContactEntryFromRuntime(input: {
  addressBookId?: string | null;
  persistence: ContactsPersistence;
  runtime: ContactLocalStateRuntime;
  userId: string;
}): Promise<void> {
  return deleteContactEntry({
    addressBookId: resolveContactsAddressBookId(input.addressBookId),
    execSql: input.runtime.execSql,
    persistence: input.persistence,
    userId: input.userId,
  });
}
