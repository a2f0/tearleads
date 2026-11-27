import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentListingRevalidationRepository } from "../../data/persistence/documents/documentListingRevalidationRepository";
import {
  createDomainScope,
  type DomainScope,
} from "../../data/shared/domainScope";
import { documentTables } from "../../data/sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { registerDocumentStore } from "../../stores/documents/registry";
import { registerDocumentStoreLoadedRecord } from "../../stores/documents/savedElsewhere";
import type { DocumentStoreFacade } from "../../stores/documents/types";
import { requestRegisteredDocumentRemoteSyncs } from "./owedRecordSyncs";

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;

beforeEach(async () => {
  const database = await createTestExecSql(`owed-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
});

afterEach(() => close());

async function insertRecord(localId: string, documentId: string) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, updated_at)
     VALUES ('documents', ?, ?, '2026-11-27T00:00:00.000Z')`,
    [localId, documentId],
  );
}

/** A registered store that has loaded the record `localId` of `documentId`. */
async function openStore(localId: string, documentId: string) {
  await insertRecord(localId, documentId);
  let remoteSyncs = 0;
  const store = {
    requestRemoteSync: () => {
      remoteSyncs += 1;
    },
  } as unknown as DocumentStoreFacade;
  registerDocumentStoreLoadedRecord(store, () => ({
    localId,
    lacks: () => false,
  }));
  registerDocumentStore(domainScope, localId, store, documentId);
  return { remoteSyncs: () => remoteSyncs };
}

function owe(localId: string, documentId: string) {
  return new DocumentListingRevalidationRepository(execSql).request([
    { accessEpoch: 1, documentId, localId, updateCount: 3 },
  ]);
}

test("a listing asks the store of each record it owed a read", async () => {
  const owed = await openStore("owed", "document-owed");
  const other = await openStore("other", "document-other");
  await owe("owed", "document-owed");
  // Owed by an earlier listing: the catch-up asks for it, not this one.
  await owe("other", "document-other");

  await requestRegisteredDocumentRemoteSyncs(domainScope, execSql, [
    "document-owed",
  ]);

  expect(owed.remoteSyncs()).toBe(1);
  expect(other.remoteSyncs()).toBe(0);
});

test("a listing asks no store when only the record it displaced owes", async () => {
  // After a relink this store holds the document; the record it displaced
  // is behind the listing, and its store never opened.
  const owner = await openStore("owner", "document-shared");
  await insertRecord("displaced", "document-shared");
  await owe("displaced", "document-shared");

  await requestRegisteredDocumentRemoteSyncs(domainScope, execSql, [
    "document-shared",
  ]);

  // The owner's pull would find no debt of its own to settle.
  expect(owner.remoteSyncs()).toBe(0);
});
