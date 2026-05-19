import { expect, test } from "bun:test";
import type { ContactEntry } from "@tearleads/client-sdk/data/contacts/addressBookEntry";
import {
  getContactEntryValue,
  setContactEntryValue,
} from "@tearleads/client-sdk/data/contacts/contactDocument";
import { getScopedPeerSeed } from "@tearleads/client-sdk/data/crdtPeerSeed";
import type { ContactsPersistence } from "@tearleads/client-sdk/data/persistence/contacts/contactsPersistence";
import type { DocumentRecord } from "@tearleads/client-sdk/data/sqlite/documentPersistence";
import type { ExecSql } from "@tearleads/client-sdk/data/sqlite/sqlSchema";
import { DEFAULT_CONTACTS_ADDRESS_BOOK_ID } from "@tearleads/client-sdk/workflows/contacts/constants";
import {
  loadContactDocumentStates,
  persistContactEntry,
} from "@tearleads/client-sdk/workflows/contacts/localState";
import type { ContactDocumentState } from "@tearleads/client-sdk/workflows/contacts/sync";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";

const execSql: ExecSql = async () => [];

function createInitialRecord(input: {
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

test("persistContactEntry leaves existing state unchanged when persistence fails", async () => {
  const originalEntry: ContactEntry = {
    encapsulationPublicKey: "peer-key-1",
    firstName: "",
    id: "peer-user-1",
    isSelf: false,
    lastName: "",
    userId: "peer-user-1",
  };
  const nextEntry: ContactEntry = {
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
      contactId: originalEntry.id,
      initialUpdate,
    }),
  };

  await expect(
    persistContactEntry({
      addressBookId: "default",
      entry: nextEntry,
      execSql,
      existingContact,
      persistence: createFailingContactsPersistence(),
    }),
  ).rejects.toThrow("save failed");

  expect(existingContact.entry).toEqual(originalEntry);
  expect(
    getContactEntryValue(
      originalEntry.id,
      existingContact.doc,
      originalEntry.isSelf,
    ),
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
