import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../sqlite/schema/documentRecordSchema";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  HELD_FRONTIER as FRONTIER,
  type HeldCursor,
  heldHead as head,
  holdListedRecord,
  LISTING_JUDGE as JUDGE,
} from "./documentListingRevalidation.testUtils";
import { DocumentListingRevalidationRepository } from "./documentListingRevalidationRepository";

const BEHIND_FRONTIER = encodeVersionVectorCounters({ "7": 2 });

let close: () => void = () => undefined;
let execSql: ExecSql;
let repository: DocumentListingRevalidationRepository;

beforeEach(async () => {
  const database = await createTestExecSql(`listing-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  repository = new DocumentListingRevalidationRepository(execSql);
});

afterEach(() => close());

function holdDocument(input: {
  readonly cursor?: HeldCursor;
  readonly documentId: string;
  readonly frontier?: string;
  readonly head?: string | null;
  readonly localId?: string;
}) {
  return holdListedRecord(execSql, input);
}

async function behind(
  documentId: string,
  updateCount: number,
  accessStateHash = head(documentId),
) {
  return (
    await repository.listBehindListing(
      [{ accessEpoch: 1, accessStateHash, documentId, updateCount }],
      JUDGE,
    )
  ).map((document) => document.documentId);
}

test("a cursor covers a listed count it reaches, and no more", async () => {
  await holdDocument({ cursor: { count: 3 }, documentId: "doc" });

  expect(await behind("doc", 2)).toEqual([]);
  expect(await behind("doc", 3)).toEqual([]);
  expect(await behind("doc", 4)).toEqual(["doc"]);
});

test.each([
  ["no cursor", undefined],
  ["a count it never learned", { count: null }],
  ["another judge", { count: 9, judge: "void-rules-0:loro-crdt@1.0.0" }],
  ["another server document", { count: 9, documentId: "replaced" }],
])("a record with %s covers nothing", async (_name, cursor) => {
  await holdDocument({ ...(cursor ? { cursor } : {}), documentId: "doc" });

  expect(await behind("doc", 1)).toEqual(["doc"]);
});

test("a cursor recorded past the record's frontier covers nothing", async () => {
  // A restore to older content: the cursor's version is no longer held.
  await holdDocument({
    cursor: { count: 9 },
    documentId: "restored",
    frontier: BEHIND_FRONTIER,
  });
  await holdDocument({
    cursor: { count: 9 },
    documentId: "unhydrated",
    frontier: "",
  });

  expect(await behind("restored", 1)).toEqual(["restored"]);
  expect(await behind("unhydrated", 1)).toEqual(["unhydrated"]);
});

test("a document with no update, or no record here, owes nothing", async () => {
  await holdDocument({ documentId: "empty" });

  expect(await behind("empty", 0)).toEqual([]);
  // Its first open has no completed pull behind it, so it pulls anyway.
  expect(await behind("never-held", 5)).toEqual([]);
});

test("a record whose key bundle names another access head is behind at any count", async () => {
  // A link change or a rotation moved the head; no update need follow it.
  await holdDocument({ cursor: { count: 3 }, documentId: "doc" });
  await holdDocument({ documentId: "empty" });
  await holdDocument({
    cursor: { count: 3 },
    documentId: "unpulled",
    head: null,
  });

  expect(await behind("doc", 3, "head:moved")).toEqual(["doc"]);
  expect(await behind("empty", 0, "head:moved")).toEqual(["empty"]);
  // A record with no key bundle has no head to compare: no listing covers
  // its store, which probes when it loads.
  expect(await behind("unpulled", 3, "head:moved")).toEqual([]);
});

test("each record a listing shows behind owes its own read", async () => {
  // An identity recovery or a relink can leave two records of one document.
  await holdDocument({ cursor: { count: 3 }, documentId: "doc" });
  await holdDocument({ documentId: "doc", localId: "displaced" });

  expect(
    await repository.listBehindListing(
      [
        {
          accessEpoch: 1,
          accessStateHash: head("doc"),
          documentId: "doc",
          updateCount: 3,
        },
      ],
      JUDGE,
    ),
  ).toEqual([
    { accessEpoch: 1, documentId: "doc", localId: "displaced", updateCount: 3 },
  ]);
});

test("a batch reports each behind record once with the newest it listed", async () => {
  await holdDocument({ cursor: { count: 1 }, documentId: "behind" });
  await holdDocument({ cursor: { count: 5 }, documentId: "covered" });

  expect(
    await repository.listBehindListing(
      [
        {
          accessEpoch: 2,
          accessStateHash: head("behind"),
          documentId: "behind",
          updateCount: 2,
        },
        {
          accessEpoch: 1,
          accessStateHash: head("covered"),
          documentId: "covered",
          updateCount: 5,
        },
        {
          accessEpoch: 1,
          accessStateHash: "head:older",
          documentId: "behind",
          updateCount: 4,
        },
      ],
      JUDGE,
    ),
  ).toEqual([
    {
      accessEpoch: 2,
      documentId: "behind",
      localId: "local-behind",
      updateCount: 4,
    },
  ]);
});

const owe = (
  documentId: string,
  updateCount: number,
  input: { readonly accessEpoch?: number; readonly localId?: string } = {},
) => ({
  accessEpoch: input.accessEpoch ?? 1,
  documentId,
  localId: input.localId ?? `local-${documentId}`,
  updateCount,
});

const record = (documentId: string, localId = `local-${documentId}`) => ({
  documentId,
  localId,
});

test("a request keeps the newest advertised count and head and renews its revision", async () => {
  await repository.request([owe("doc", 4, { accessEpoch: 3 })]);
  const first = await repository.find(record("doc"));
  // A listing served by a lagging replica never lowers the debt.
  await repository.request([owe("doc", 2, { accessEpoch: 2 })]);
  const second = await repository.find(record("doc"));

  expect(first?.advertisedUpdateCount).toBe(4);
  expect(second?.advertisedUpdateCount).toBe(4);
  expect(second?.advertisedAccessEpoch).toBe(3);
  expect(second?.revision).not.toBe(first?.revision);
  expect(await repository.listOwed()).toEqual([record("doc")]);
});

test("a record that now names another document owes that one alone", async () => {
  await repository.request([owe("old", 9, { accessEpoch: 9, localId: "l" })]);
  await repository.request([owe("new", 1, { accessEpoch: 1, localId: "l" })]);

  expect(await repository.find(record("old", "l"))).toBeNull();
  expect(await repository.find(record("new", "l"))).toMatchObject({
    advertisedAccessEpoch: 1,
    advertisedUpdateCount: 1,
  });
});

test("debts of records that no longer hold their document are forgotten", async () => {
  await holdDocument({ documentId: "held" });
  await holdDocument({ documentId: "repointed", localId: "moved" });
  // A container metadata record of the same id holds no ordinary document.
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('container-metadata', 'local-purged', 'purged', ?, '2026-11-25T00:00:00.000Z')`,
    [FRONTIER],
  );
  await repository.request([
    owe("held", 2),
    owe("purged", 2),
    owe("other", 2, { localId: "moved" }),
  ]);

  await repository.forgetUnheld();

  expect(await repository.listOwed()).toEqual([record("held")]);
});
