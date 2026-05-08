import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import {
  getContactEntryValue,
  setContactEntryValue,
} from "../../data/contacts/contactDocument";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import type { ContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "./constants";
import {
  loadContactDocumentStates,
  persistImportedContactEntry,
} from "./localState";
import type { ContactDocumentState } from "./sync";

const execSql: ExecSql = async () => [];

function createInitialRecord(input: {
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

function createFailingContactsPersistence(): ContactsPersistence {
  return {
    async ensureSchema() {},
    async loadContacts() {
      return [];
    },
    async saveContact() {
      throw new Error("save failed");
    },
    async saveContactAndDeletePendingUpdates() {
      throw new Error("save failed");
    },
    async deleteContact() {},
    async listPendingUpdates() {
      return [];
    },
    async enqueuePendingUpdate() {},
    async deletePendingUpdates() {},
  };
}

test("persistImportedContactEntry leaves existing state unchanged when persistence fails", async () => {
  const originalEntry: AddressBookEntry = {
    encapsulationPublicKey: "peer-key-1",
    isSelf: false,
    userId: "peer-user-1",
  };
  const nextEntry: AddressBookEntry = {
    ...originalEntry,
    encapsulationPublicKey: "peer-key-2",
  };
  const doc = await createDocument(getScopedPeerSeed("contacts"));
  setContactEntryValue(doc, originalEntry);
  const initialUpdate = exportAllUpdates(doc);
  const existingContact: ContactDocumentState = {
    doc,
    entry: originalEntry,
    record: createInitialRecord({
      initialUpdate,
      userId: originalEntry.userId,
    }),
  };

  await expect(
    persistImportedContactEntry({
      addressBookId: "default",
      entry: nextEntry,
      execSql,
      existingContact,
      persistence: createFailingContactsPersistence(),
    }),
  ).rejects.toThrow("save failed");

  expect(existingContact.entry).toEqual(originalEntry);
  expect(
    getContactEntryValue(originalEntry.userId, existingContact.doc, false),
  ).toEqual(originalEntry);
  expect(existingContact.record.loroSnapshot).toBe(
    bytesToBase64(initialUpdate),
  );
});

test("loadContactDocumentStates binds the default address book to the runtime executor", async () => {
  const calls: Array<{
    addressBookId: string;
    execSql: ExecSql;
  }> = [];
  const persistence: ContactsPersistence = {
    async ensureSchema(receivedExecSql) {
      calls.push({
        addressBookId: "ensure",
        execSql: receivedExecSql,
      });
    },
    async loadContacts(receivedExecSql, addressBookId) {
      calls.push({
        addressBookId,
        execSql: receivedExecSql,
      });
      return [];
    },
    async saveContact() {},
    async saveContactAndDeletePendingUpdates() {},
    async deleteContact() {},
    async listPendingUpdates() {
      return [];
    },
    async enqueuePendingUpdate() {},
    async deletePendingUpdates() {},
  };

  await loadContactDocumentStates({
    persistence,
    runtime: { execSql },
  });

  expect(calls).toEqual([
    {
      addressBookId: "ensure",
      execSql,
    },
    {
      addressBookId: DEFAULT_CONTACTS_ADDRESS_BOOK_ID,
      execSql,
    },
  ]);
});
