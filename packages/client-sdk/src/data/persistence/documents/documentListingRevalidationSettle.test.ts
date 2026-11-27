import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import {
  heldHead,
  holdListedRecord,
  LISTING_JUDGE as JUDGE,
  saveHeldCursor,
  saveHeldHead,
} from "./documentListingRevalidation.testUtils";
import {
  type DocumentListingRevalidation,
  DocumentListingRevalidationRepository,
  type ListedDocumentHead,
} from "./documentListingRevalidationRepository";

const DOCUMENT_ID = "doc";

let close: () => void = () => undefined;
let execSql: ExecSql;
let repository: DocumentListingRevalidationRepository;

beforeEach(async () => {
  const database = await createTestExecSql(`settle-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  repository = new DocumentListingRevalidationRepository(execSql);
});

afterEach(() => close());

function listed(
  updateCount: number,
  head: { readonly epoch: number; readonly hash: string } = {
    epoch: 1,
    hash: heldHead(DOCUMENT_ID),
  },
): ReadonlyArray<ListedDocumentHead> {
  return [
    {
      accessEpoch: head.epoch,
      accessStateHash: head.hash,
      documentId: DOCUMENT_ID,
      updateCount,
    },
  ];
}

/** Owes what `listing` shows to every record behind it. */
async function oweListing(
  listing: ReadonlyArray<ListedDocumentHead>,
): Promise<void> {
  await repository.request(await repository.listBehindListing(listing, JUDGE));
}

/** The debt `localId` holds. */
async function debtOf(localId: string): Promise<DocumentListingRevalidation> {
  const owed = await repository.find({ documentId: DOCUMENT_ID, localId });
  if (!owed) throw new Error(`Expected ${localId} to owe a read`);
  return owed;
}

/** Owes what `listing` shows; returns the debt `localId` now holds. */
async function owe(
  listing: ReadonlyArray<ListedDocumentHead>,
  localId: string,
): Promise<DocumentListingRevalidation> {
  await oweListing(listing);
  return debtOf(localId);
}

/** A completed pull of `localId` that counted `count` updates. */
function pull(localId: string, count: number) {
  return saveHeldCursor(execSql, localId, {
    cursor: { count },
    documentId: DOCUMENT_ID,
  });
}

test("a record's pull settles its own debt and leaves the displaced record's", async () => {
  // An identity recovery or a relink left two records of one document.
  const owner = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
    localId: "owner",
  });
  const displaced = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
    localId: "displaced",
  });
  await oweListing(listed(4));
  const owed = await debtOf(owner);
  await debtOf(displaced);

  await pull(owner, 4);

  expect(await repository.settle(owed, JUDGE)).toBe(true);
  expect(
    await repository.find({ documentId: DOCUMENT_ID, localId: owner }),
  ).toBeNull();
  // The record still behind keeps what the listing showed it, so its store
  // probes when it loads, although no listing serves the row again.
  expect(
    await repository.find({ documentId: DOCUMENT_ID, localId: displaced }),
  ).toMatchObject({ advertisedUpdateCount: 4 });
  expect(await repository.listOwed()).toEqual([
    { documentId: DOCUMENT_ID, localId: displaced },
  ]);
});

test("a pull settles nothing for another record", async () => {
  const owner = await holdListedRecord(execSql, {
    cursor: { count: 4 },
    documentId: DOCUMENT_ID,
    localId: "owner",
  });
  const displaced = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
    localId: "displaced",
  });
  const owed = await owe(listed(4), displaced);

  // The owner's cursor covers the count, so the owner owes nothing, and its
  // pull reads no debt to settle. The displaced record's cursor does not.
  expect(
    await repository.find({ documentId: DOCUMENT_ID, localId: owner }),
  ).toBeNull();
  expect(await repository.settle(owed, JUDGE)).toBe(false);
  expect(await repository.listOwed()).toEqual([
    { documentId: DOCUMENT_ID, localId: displaced },
  ]);
});

test("a record pointed at another document pays nothing of the one it owed", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
  });
  const owed = await owe(listed(4), localId);
  // A relink pointed the record at another server document, whose pull then
  // counted as many updates as the listing showed for this one.
  await execSql("UPDATE documents SET document_id = 'another-document'");
  await saveHeldCursor(execSql, localId, {
    cursor: { count: 4 },
    documentId: "another-document",
  });

  expect(await repository.settle(owed, JUDGE)).toBe(false);
});

test("a pull that counted fewer updates than the listing settles nothing", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 2 },
    documentId: DOCUMENT_ID,
  });
  const owed = await owe(listed(3), localId);

  // A replica lagging the listing answered.
  expect(await repository.settle(owed, JUDGE)).toBe(false);
  await pull(localId, 3);
  expect(await repository.settle(owed, JUDGE)).toBe(true);
});

test("a debt for a moved head settles only once the record's bundle carries it", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
  });
  // A peer's link change moved the head; no update followed it.
  const owed = await owe(listed(3, { epoch: 2, hash: "head:moved" }), localId);
  expect(owed.advertisedAccessEpoch).toBe(2);

  // A pull a replica answered from before the move saves the older head
  // again, and counts every update: it pays nothing.
  expect(await repository.settle(owed, JUDGE)).toBe(false);

  await saveHeldHead(execSql, localId, "head:moved", 2);
  expect(await repository.settle(owed, JUDGE)).toBe(true);
});

test("a bundle of a later head pays a debt for an earlier one", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 0 },
    documentId: DOCUMENT_ID,
  });
  const owed = await owe(listed(0, { epoch: 2, hash: "head:moved" }), localId);

  // The head moved again before the pull: it read past what was listed.
  await saveHeldHead(execSql, localId, "head:moved-again", 3);
  expect(await repository.settle(owed, JUDGE)).toBe(true);
});

test("a record pays at the head its pull read, and with no key bundle pays nothing", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 3 },
    documentId: DOCUMENT_ID,
  });
  const owed = await owe(listed(3, { epoch: 2, hash: "head:moved" }), localId);

  // The apply that moved the record's access epoch dropped its key bundle;
  // whatever manifest it kept, it has no access context to present.
  await saveHeldHead(execSql, localId, "head:moved", 2);
  await execSql("UPDATE documents SET content_key_bundle = NULL");
  expect(await repository.settle(owed, JUDGE)).toBe(false);

  // The pull read the moved head, and the server's key bundle still names
  // the manifest before it: no later read would reissue it.
  await execSql(`UPDATE documents SET content_key_bundle = ?`, [
    JSON.stringify({ linkSetManifestHash: heldHead(DOCUMENT_ID) }),
  ]);
  expect(await repository.settle(owed, JUDGE)).toBe(true);
});

test("a read settles only the request it saw", async () => {
  const localId = await holdListedRecord(execSql, {
    cursor: { count: 0 },
    documentId: DOCUMENT_ID,
  });
  const seen = await owe(listed(1), localId);
  const newer = await owe(listed(2), localId);
  await pull(localId, 2);

  expect(await repository.settle(seen, JUDGE)).toBe(true);
  expect(
    (await repository.find({ documentId: DOCUMENT_ID, localId }))
      ?.advertisedUpdateCount,
  ).toBe(2);

  expect(await repository.settle(newer, JUDGE)).toBe(true);
  expect(await repository.listOwed()).toEqual([]);
});
