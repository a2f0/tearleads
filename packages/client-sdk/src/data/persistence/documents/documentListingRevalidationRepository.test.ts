import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../sqlite/schema/documentRecordSchema";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlSchema";
import { DocumentListingRevalidationRepository } from "./documentListingRevalidationRepository";

const JUDGE = "void-rules-1:loro-crdt@1.0.0";
const FRONTIER = encodeVersionVectorCounters({ "7": 4 });
const BEHIND_FRONTIER = encodeVersionVectorCounters({ "7": 2 });

/** The access head a held record's key bundle names unless a test says otherwise. */
const head = (documentId: string) => `head:${documentId}`;

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

/** A held record, and the cursor its last completed pull left, if any. */
async function holdDocument(input: {
  readonly cursor?: {
    readonly count: number | null;
    readonly documentId?: string;
    readonly judge?: string;
    readonly version?: string;
  };
  readonly documentId: string;
  readonly frontier?: string;
  /** The head the record's key bundle names; `null` for a record with no bundle. */
  readonly head?: string | null;
  readonly localId?: string;
}) {
  const localId = input.localId ?? `local-${input.documentId}`;
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, content_key_bundle, updated_at)
     VALUES ('documents', ?, ?, ?, ?, '2026-11-25T00:00:00.000Z')`,
    [
      localId,
      input.documentId,
      input.frontier ?? FRONTIER,
      input.head === null
        ? null
        : JSON.stringify({
            linkSetManifestHash: input.head ?? head(input.documentId),
          }),
    ],
  );
  if (!input.cursor) return;
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_update_count, through_version, judge)
     VALUES ('documents', ?, ?, 'update', ?, ?, ?)`,
    [
      localId,
      input.cursor.documentId ?? input.documentId,
      input.cursor.count,
      input.cursor.version ?? FRONTIER,
      input.cursor.judge ?? JUDGE,
    ],
  );
}

async function behind(
  documentId: string,
  updateCount: number,
  accessStateHash = head(documentId),
) {
  return (
    await repository.listBehindListing(
      [{ accessStateHash, documentId, updateCount }],
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

test("every record holding the document must be covered", async () => {
  await holdDocument({ cursor: { count: 3 }, documentId: "doc" });
  await holdDocument({ documentId: "doc", localId: "displaced" });

  expect(await behind("doc", 3)).toEqual(["doc"]);
});

test("a batch reports each behind document once with its largest count", async () => {
  await holdDocument({ cursor: { count: 1 }, documentId: "behind" });
  await holdDocument({ cursor: { count: 5 }, documentId: "covered" });

  expect(
    await repository.listBehindListing(
      [
        {
          accessStateHash: head("behind"),
          documentId: "behind",
          updateCount: 2,
        },
        {
          accessStateHash: head("covered"),
          documentId: "covered",
          updateCount: 5,
        },
        {
          accessStateHash: head("behind"),
          documentId: "behind",
          updateCount: 4,
        },
      ],
      JUDGE,
    ),
  ).toEqual([{ documentId: "behind", updateCount: 4 }]);
});

test("a request keeps the largest advertised count and renews its revision", async () => {
  await repository.request([{ documentId: "doc", updateCount: 4 }]);
  const first = await repository.find("doc");
  // A listing served by a lagging replica never lowers the debt.
  await repository.request([{ documentId: "doc", updateCount: 2 }]);
  const second = await repository.find("doc");

  expect(first?.advertisedUpdateCount).toBe(4);
  expect(second?.advertisedUpdateCount).toBe(4);
  expect(second?.revision).not.toBe(first?.revision);
  expect(await repository.listOwedDocumentIds()).toEqual(["doc"]);
});

test("a read settles only the request it saw", async () => {
  await repository.request([{ documentId: "doc", updateCount: 1 }]);
  const seen = await repository.find("doc");
  if (!seen) throw new Error("Expected the request");
  await repository.request([{ documentId: "doc", updateCount: 2 }]);

  await repository.settle(seen);
  expect((await repository.find("doc"))?.advertisedUpdateCount).toBe(2);

  const newer = await repository.find("doc");
  if (!newer) throw new Error("Expected the newer request");
  await repository.settle(newer);
  expect(await repository.find("doc")).toBeNull();
  expect(await repository.listOwedDocumentIds()).toEqual([]);
});

test("debts of documents no record holds are forgotten, and held ones stay", async () => {
  await holdDocument({ documentId: "held" });
  // A container metadata record of the same id holds no ordinary document.
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('container-metadata', 'meta', 'purged', ?, '2026-11-25T00:00:00.000Z')`,
    [FRONTIER],
  );
  await repository.request([
    { documentId: "held", updateCount: 2 },
    { documentId: "purged", updateCount: 2 },
  ]);

  await repository.forgetUnheld();

  expect(await repository.listOwedDocumentIds()).toEqual(["held"]);
});
