import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createMockApiClient } from "../../../test/helpers/createMockApiClient";
import type { AddressBookEntry } from "../../data/contacts/addressBookEntry";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContactDocumentState,
  hasContactDocumentUpdateEvent,
  syncContactDocuments,
} from "./sync";

const execSql: ExecSql = async () => [];
const resolveProjectionUserKey: ProjectionUserKeyResolver = async () => null;

function createContactEntry(userId: string): AddressBookEntry {
  return {
    encapsulationPublicKey: `${userId}-key`,
    isSelf: false,
    userId,
  };
}

function createContactRecord(userId: string): DocumentRecord {
  return {
    id: userId,
    documentId: null,
    loroSnapshot: "",
    accessEpoch: 1,
    accessStateHash: null,
    lastCommitLsn: null,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
}

async function createContact(userId: string): Promise<ContactDocumentState> {
  const entry = createContactEntry(userId);

  return {
    doc: await createDocument(getScopedPeerSeed("contacts-test")),
    entry,
    record: createContactRecord(userId),
  };
}

function createNoopContactsPersistence(
  listPendingUpdates: ContactsPersistence["listPendingUpdates"],
): ContactsPersistence {
  return {
    async ensureSchema() {},
    async loadContacts() {
      return [];
    },
    async saveContact() {},
    async saveContactAndDeletePendingUpdates() {},
    async deleteContact() {},
    listPendingUpdates,
    async enqueuePendingUpdate() {},
    async deletePendingUpdates() {},
  };
}

test("syncContactDocuments logs a contact failure and continues with remaining contacts", async () => {
  const requestedContactIds: string[] = [];
  const logMessages: string[] = [];
  const firstContact = await createContact("peer-user-1");
  const secondContact = await createContact("peer-user-2");
  const persistence = createNoopContactsPersistence(
    async (_execSql, userId) => {
      requestedContactIds.push(userId);
      if (userId === firstContact.entry.userId) {
        throw new Error("pending update read failed");
      }

      return [];
    },
  );

  const result = await syncContactDocuments({
    addressBookId: "default",
    contacts: [firstContact, secondContact],
    persistence,
    ready: true,
    resolveProjectionUserKey,
    runtime: {
      apiClient: createMockApiClient(),
      containerId: "root-container",
      encapsulationKeyPair: {
        publicKey: new Uint8Array([1]),
        secretKey: new Uint8Array([2]),
      },
      execSql,
      isAuthenticated: true,
      log: (message) => logMessages.push(message),
      online: true,
    },
  });

  expect(result).toEqual({
    shouldRequestFollowupSync: false,
    syncedContactCount: 0,
  });
  expect(requestedContactIds).toEqual([
    firstContact.entry.userId,
    secondContact.entry.userId,
  ]);
  expect(logMessages).toEqual([
    "Contacts (peer-user-1): sync failed: pending update read failed",
  ]);
});

test("syncContactDocuments rethrows destroyed database runtime errors", async () => {
  const logMessages: string[] = [];
  const contact = await createContact("peer-user-1");
  const persistence = createNoopContactsPersistence(async () => {
    throw new Error("outer", {
      cause: new Error("Database worker client has been destroyed."),
    });
  });

  await expect(
    syncContactDocuments({
      addressBookId: "default",
      contacts: [contact],
      persistence,
      ready: true,
      resolveProjectionUserKey,
      runtime: {
        apiClient: createMockApiClient(),
        containerId: "root-container",
        encapsulationKeyPair: {
          publicKey: new Uint8Array([1]),
          secretKey: new Uint8Array([2]),
        },
        execSql,
        isAuthenticated: true,
        log: (message) => logMessages.push(message),
        online: true,
      },
    }),
  ).rejects.toThrow("outer");
  expect(logMessages).toEqual([]);
});

test("hasContactDocumentUpdateEvent detects updates for contact remote documents", async () => {
  const contact = await createContact("peer-user-1");
  contact.record = {
    ...contact.record,
    documentId: "contact-document-1",
  };

  expect(
    hasContactDocumentUpdateEvent(
      [
        {
          documentId: "contact-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [contact],
    ),
  ).toBe(true);
  expect(
    hasContactDocumentUpdateEvent(
      [
        {
          documentId: "other-document",
          id: "event-2",
          type: "document_update_created",
        },
      ],
      [contact],
    ),
  ).toBe(false);
  expect(
    hasContactDocumentUpdateEvent(
      [
        {
          documentId: "contact-document-1",
          id: "event-3",
          type: "other_event",
        },
      ],
      [contact],
    ),
  ).toBe(false);
});

test("hasContactDocumentUpdateEvent ignores contacts without remote document ids", async () => {
  const contact = await createContact("peer-user-1");

  expect(
    hasContactDocumentUpdateEvent(
      [
        {
          documentId: "contact-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [contact],
    ),
  ).toBe(false);
});
