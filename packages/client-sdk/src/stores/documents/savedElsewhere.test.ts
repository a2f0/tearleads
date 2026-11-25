import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  encodeVersionVectorCounters,
  exportFullHistorySnapshot,
  importSnapshot,
  updateText,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createDomainScope,
  type DomainScope,
} from "../../data/shared/domainScope";
import { documentTables } from "../../data/sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import { describeLoadedDocumentRecord } from "./documentStore/sync/loadedRecord";
import { registerDocumentStore } from "./registry";
import {
  forwardDocumentStoreLoadedRecord,
  registerDocumentStoreLoadedRecord,
  requestRemoteSyncsOfRecordsSavedElsewhere,
} from "./savedElsewhere";
import type { DocumentStore, DocumentStoreFacade } from "./types";

let close: () => void = () => undefined;
let execSql: ExecSql;
let domainScope: DomainScope;

beforeEach(async () => {
  const database = await createTestExecSql(`elsewhere-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  domainScope = createDomainScope();
});

afterEach(() => close());

async function persistFrontier(localId: string, frontier: string) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('documents', ?, ?, ?, '2026-11-25T00:00:00.000Z')
     ON CONFLICT (app_kind, local_id) DO UPDATE SET
       snapshot_end_version = excluded.snapshot_end_version`,
    [localId, `document-${localId}`, frontier],
  );
}

/** A registered store whose document in memory covers `heldFrontiers`. */
function openStore(localId: string, heldFrontiers: ReadonlyArray<string>) {
  let remoteSyncs = 0;
  const backing = {
    requestRemoteSync: () => {
      remoteSyncs += 1;
    },
  } as unknown as DocumentStore;
  registerDocumentStoreLoadedRecord(backing, () => ({
    localId,
    lacks: (frontier) => !heldFrontiers.includes(frontier),
  }));
  const facade = {
    requestRemoteSync: () => backing.requestRemoteSync(),
  } as unknown as DocumentStoreFacade;
  forwardDocumentStoreLoadedRecord(facade, backing);
  registerDocumentStore(domainScope, localId, facade, `document-${localId}`);
  return { remoteSyncs: () => remoteSyncs };
}

const LOADED = encodeVersionVectorCounters({ "7": 4 });
const SAVED_ELSEWHERE = encodeVersionVectorCounters({ "7": 4, "9": 2 });

test("only a store that lacks what its record has on disk is asked to pull", async () => {
  // Another runtime on this database saved the first record past this one.
  await persistFrontier("behind", SAVED_ELSEWHERE);
  await persistFrontier("current", LOADED);
  const behind = openStore("behind", [LOADED]);
  const current = openStore("current", [LOADED]);
  // A record this store created and has not saved yet is not on disk.
  const unsaved = openStore("unsaved", []);

  expect(
    await requestRemoteSyncsOfRecordsSavedElsewhere(domainScope, execSql),
  ).toBe(1);

  expect(behind.remoteSyncs()).toBe(1);
  expect(current.remoteSyncs()).toBe(0);
  expect(unsaved.remoteSyncs()).toBe(0);
});

test("a store with no loaded remote record is not asked", async () => {
  await persistFrontier("loading", SAVED_ELSEWHERE);
  let remoteSyncs = 0;
  const store = {
    requestRemoteSync: () => {
      remoteSyncs += 1;
    },
  } as unknown as DocumentStoreFacade;
  registerDocumentStoreLoadedRecord(store, () => null);
  registerDocumentStore(domainScope, "loading", store, "document-loading");

  expect(
    await requestRemoteSyncsOfRecordsSavedElsewhere(domainScope, execSql),
  ).toBe(0);
  expect(remoteSyncs).toBe(0);
  // A scope with no registered store reads nothing.
  expect(
    await requestRemoteSyncsOfRecordsSavedElsewhere(
      createDomainScope(),
      execSql,
    ),
  ).toBe(0);
});

test("a store compares the document it holds in memory, not its record", async () => {
  const mine = await createDocument("mine");
  updateText(mine, "mine");
  mine.commit();
  const loadedFrontier = encodeVersionVector(mine);
  // Another runtime pulled a peer's edit into its own copy and saved it.
  const peer = await createDocument("peer");
  importSnapshot(peer, exportFullHistorySnapshot(mine));
  updateText(peer, "mine and a peer");
  peer.commit();
  const savedElsewhere = encodeVersionVector(peer);

  const state = {
    doc: mine,
    localId: "local-1",
    record: { documentId: "document-1", snapshotEndVersion: loadedFrontier },
  } as unknown as Parameters<typeof describeLoadedDocumentRecord>[0];
  const loaded = describeLoadedDocumentRecord(state);

  expect(loaded?.localId).toBe("local-1");
  expect(loaded?.lacks(loadedFrontier)).toBe(false);
  expect(loaded?.lacks(savedElsewhere)).toBe(true);

  // A save of this store's own that is still in flight: the disk is ahead of
  // the record, but the document in memory already holds what it wrote.
  updateText(mine, "mine, edited");
  mine.commit();
  expect(loaded?.lacks(encodeVersionVector(mine))).toBe(false);

  // A save merges its frontier with the durable one, so the record can name
  // the other runtime's content before the document holds it.
  state.record = {
    documentId: "document-1",
    snapshotEndVersion: savedElsewhere,
  } as typeof state.record;
  expect(loaded?.lacks(savedElsewhere)).toBe(true);

  // Once the store holds the peer's edit, the other runtime's save is covered.
  importSnapshot(mine, exportFullHistorySnapshot(peer));
  expect(loaded?.lacks(savedElsewhere)).toBe(false);
});

test("a store with no server document or no document in memory has no loaded record", () => {
  const describe = (state: unknown) =>
    describeLoadedDocumentRecord(
      state as Parameters<typeof describeLoadedDocumentRecord>[0],
    );

  expect(describe({ doc: {}, localId: "l", record: null })).toBeNull();
  expect(
    describe({ doc: {}, localId: "l", record: { documentId: null } }),
  ).toBeNull();
  expect(
    describe({ doc: null, localId: "l", record: { documentId: "d" } }),
  ).toBeNull();
});
