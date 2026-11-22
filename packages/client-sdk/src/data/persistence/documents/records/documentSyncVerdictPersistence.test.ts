import { afterEach, beforeEach, expect, test } from "bun:test";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../../sqlite/sqlSchema";
import { DocumentRecordRepository } from "./documentRecordRepository";
import {
  type DocumentSyncVerdictInput,
  readSendableProcessedCursor,
  recordDocumentSyncVerdictsInTransaction,
} from "./documentSyncVerdictPersistence";
import type { PullPagePosition } from "./processedCursorState";

const SCOPE = { appKind: "documents", localId: "held" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440900";
const JUDGE = "void-rules-1:loro-crdt@1.0.0";
const THROUGH = "550e8400-e29b-41d4-a716-446655440901";
const LIAR = "550e8400-e29b-41d4-a716-446655440902";
const OTHER_LIAR = "550e8400-e29b-41d4-a716-446655440903";
const FRONTIER = encodeVersionVectorCounters({ "7": 4 });

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`verdicts-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  await setRecord(FRONTIER);
});

afterEach(() => close());

async function setRecord(frontier: string, documentId = DOCUMENT_ID) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES (?, ?, ?, ?, '2026-11-22T00:00:00.000Z')
     ON CONFLICT (app_kind, local_id) DO UPDATE SET
       document_id = excluded.document_id,
       snapshot_end_version = excluded.snapshot_end_version`,
    [SCOPE.appKind, SCOPE.localId, documentId, frontier],
  );
}

function record(overrides: Partial<DocumentSyncVerdictInput> = {}) {
  return recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: JUDGE,
      keyFingerprintsByEpoch: new Map([[1, "key-a"]]),
      now: "2026-11-22T00:00:01.000Z",
      scope: SCOPE,
      voids: [],
      ...overrides,
    },
  );
}

function liar(updateId = LIAR) {
  return {
    contentKeyEpoch: 1,
    message: "declared span is false",
    stage: "loro_metadata",
    updateId,
  };
}

function sendable(
  overrides: Partial<Parameters<typeof readSendableProcessedCursor>[1]> = {},
) {
  return readSendableProcessedCursor(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      documentId: DOCUMENT_ID,
      frontier: FRONTIER,
      judge: JUDGE,
      scope: SCOPE,
      ...overrides,
    },
  );
}

async function voidIds() {
  const rows = (await execSql(
    "SELECT update_id FROM document_void_updates ORDER BY update_id",
  )) as { update_id: string }[];
  return rows.map((row) => row.update_id);
}

const completed: PullPagePosition = {
  first: true,
  last: true,
  sentCursor: null,
  throughUpdateId: THROUGH,
};

test("a completed pull's cursor is sent only while every input behind it holds", async () => {
  expect(await sendable()).toBeUndefined();
  expect(await record({ pullPage: completed })).toEqual({
    cursorCleared: false,
    newlyVoidedUpdateIds: [],
  });
  expect(await sendable()).toBe(THROUGH);

  // Another server document, another judge, or a frontier that no longer
  // covers the recorded one (state replaced by an older copy).
  expect(await sendable({ documentId: LIAR })).toBeUndefined();
  expect(await sendable({ judge: "void-rules-1:loro-crdt@2.0.0" })).toBe(
    undefined,
  );
  expect(
    await sendable({ frontier: encodeVersionVectorCounters({ "7": 3 }) }),
  ).toBeUndefined();
  expect(
    await sendable({ frontier: encodeVersionVectorCounters({ "7": 9 }) }),
  ).toBe(THROUGH);
});

test("a void judged by another decoder withholds the cursor until a pull without it judges again", async () => {
  await record({ pullPage: completed, voids: [liar()] });
  expect(await sendable()).toBe(THROUGH);
  const upgraded = "void-rules-1:loro-crdt@2.0.0";
  expect(await sendable({ judge: upgraded })).toBeUndefined();

  // The upgraded device pulls by version; this time the update joins.
  await record({
    acceptedUpdateIds: [],
    pullPage: completed,
    judge: upgraded,
  });
  expect(await voidIds()).toEqual([]);
  expect(await sendable({ judge: upgraded })).toBe(THROUGH);
});

test("a void is reported once and dropped when the update is accepted", async () => {
  expect((await record({ voids: [liar()] })).newlyVoidedUpdateIds).toEqual([
    LIAR,
  ]);
  expect(
    (await record({ voids: [liar(), liar(OTHER_LIAR)] })).newlyVoidedUpdateIds,
  ).toEqual([OTHER_LIAR]);
  await record({ acceptedUpdateIds: [LIAR] });
  expect(await voidIds()).toEqual([OTHER_LIAR]);
});

test("a void judged under another key for its epoch is dropped with the cursor", async () => {
  await record({ pullPage: completed, voids: [liar()] });
  expect(await sendable()).toBe(THROUGH);

  const outcome = await record({
    pullPage: { ...completed, sentCursor: THROUGH },
    keyFingerprintsByEpoch: new Map([[1, "key-b"]]),
  });
  expect(outcome).toEqual({ cursorCleared: true, newlyVoidedUpdateIds: [] });
  expect(await voidIds()).toEqual([]);
  expect(await sendable()).toBeUndefined();

  // Another epoch's key says nothing about this void.
  await record({ pullPage: completed, voids: [liar()] });
  expect(
    (
      await record({
        pullPage: completed,
        keyFingerprintsByEpoch: new Map([[2, "key-c"]]),
      })
    ).cursorCleared,
  ).toBe(false);
  expect(await voidIds()).toEqual([LIAR]);
});

test("a scope that is gone or holds another document keeps no verdicts", async () => {
  await setRecord(FRONTIER, OTHER_LIAR);
  expect(await record({ pullPage: completed, voids: [liar()] })).toEqual({
    cursorCleared: false,
    newlyVoidedUpdateIds: [],
  });
  expect(await voidIds()).toEqual([]);
  expect(await sendable({ documentId: OTHER_LIAR })).toBeUndefined();

  await setRecord(FRONTIER);
  await record({ pullPage: completed, voids: [liar()] });
  await new DocumentRecordRepository(execSql).deleteDocumentRecord(SCOPE);
  expect(await voidIds()).toEqual([]);
  expect(await execSql("SELECT local_id FROM document_sync_progress")).toEqual(
    [],
  );
});

const UPGRADED = "void-rules-1:loro-crdt@2.0.0";
const NEXT_THROUGH = "550e8400-e29b-41d4-a716-446655440904";

test("a pull whose later page runs under another judge leaves the cursor and the old judge's voids", async () => {
  await record({ pullPage: completed, voids: [liar()] });
  // The next pull's first page goes out with the cursor under the old judge.
  await record({
    pullPage: {
      first: true,
      last: false,
      sentCursor: THROUGH,
      throughUpdateId: NEXT_THROUGH,
    },
  });
  // The SDK upgrades before the last page, which sends no cursor; the server
  // still serves after the old one, so the liar is not judged again.
  await record({
    judge: UPGRADED,
    pullPage: {
      first: false,
      last: true,
      sentCursor: null,
      throughUpdateId: NEXT_THROUGH,
    },
  });
  expect(await voidIds()).toEqual([LIAR]);
  expect(await sendable({ judge: UPGRADED })).toBeUndefined();
  expect(await sendable()).toBe(THROUGH);

  // A whole pull under the new judge judges the liar again and advances.
  await record({
    judge: UPGRADED,
    pullPage: { ...completed, throughUpdateId: NEXT_THROUGH },
  });
  expect(await voidIds()).toEqual([]);
  expect(await sendable({ judge: UPGRADED })).toBe(NEXT_THROUGH);
});

test("a pull whose pages keep one premise advances on its last page", async () => {
  await record({ pullPage: completed });
  const premise = { sentCursor: THROUGH, throughUpdateId: NEXT_THROUGH };
  await record({ pullPage: { ...premise, first: true, last: false } });
  await record({ pullPage: { ...premise, first: false, last: false } });
  expect(await sendable()).toBe(THROUGH);
  await record({ pullPage: { ...premise, first: false, last: true } });
  expect(await sendable()).toBe(NEXT_THROUGH);
});

test("a key conflict on an earlier page keeps the pull's last page from recording a cursor", async () => {
  await record({ pullPage: completed, voids: [liar()] });
  const pages = { sentCursor: THROUGH, throughUpdateId: NEXT_THROUGH };
  expect(
    (
      await record({
        keyFingerprintsByEpoch: new Map([[1, "key-b"]]),
        pullPage: { ...pages, first: true, last: false },
      })
    ).cursorCleared,
  ).toBe(true);
  await record({ pullPage: { ...pages, first: false, last: true } });
  expect(await sendable()).toBeUndefined();
});
