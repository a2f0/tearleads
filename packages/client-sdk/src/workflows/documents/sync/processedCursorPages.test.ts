import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { recordDocumentSyncVerdicts } from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "paged" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440d00";
const FIRST_THROUGH = "550e8400-e29b-41d4-a716-446655440d01";
const NEXT_THROUGH = "550e8400-e29b-41d4-a716-446655440d02";

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`pages-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureDocumentTables(execSql);
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES (?, ?, ?, '', '2026-11-22T00:00:00.000Z')`,
    [SCOPE.appKind, SCOPE.localId, DOCUMENT_ID],
  );
});

afterEach(() => close());

/** Records one page of a pull, as a store's record save does. */
async function recordPage(page: {
  readonly continuation?: string;
  readonly held?: boolean;
  readonly last: boolean;
  readonly sentCursor?: string;
  readonly throughUpdateId: string;
}): Promise<void> {
  const synced = {
    decryptedUpdates: [],
    hasHeldPull: page.held === true,
    hasIncompletePull: !page.last,
    plan: {
      documentId: DOCUMENT_ID,
      request: {
        ...(page.continuation === undefined
          ? {}
          : { pullCursor: page.continuation }),
        ...(page.sentCursor === undefined
          ? {}
          : { processedThroughUpdateId: page.sentCursor }),
      },
    },
    response: { pullPage: { throughUpdateId: page.throughUpdateId } },
    voidedUpdates: [],
  } as unknown as SyncRemoteDocumentResult;
  await recordDocumentSyncVerdicts(execSql, { scope: SCOPE, synced });
}

async function recordedCursor(): Promise<unknown> {
  const [row] = await execSql(
    "SELECT through_update_id FROM document_sync_progress WHERE local_id = ?",
    [SCOPE.localId],
  );
  if (!row) return undefined;
  const { through_update_id: throughUpdateId } = row;
  return throughUpdateId;
}

test("a continuation page sent under the first page's cursor completes the pull", async () => {
  await recordPage({ last: true, throughUpdateId: FIRST_THROUGH });
  expect(await recordedCursor()).toBe(FIRST_THROUGH);

  await recordPage({
    last: false,
    sentCursor: FIRST_THROUGH,
    throughUpdateId: NEXT_THROUGH,
  });
  expect(await recordedCursor()).toBe(FIRST_THROUGH);
  await recordPage({
    continuation: "page-2",
    last: true,
    sentCursor: FIRST_THROUGH,
    throughUpdateId: NEXT_THROUGH,
  });
  expect(await recordedCursor()).toBe(NEXT_THROUGH);
});

test("a continuation page sent without the first page's cursor leaves the cursor", async () => {
  await recordPage({ last: true, throughUpdateId: FIRST_THROUGH });
  await recordPage({
    last: false,
    sentCursor: FIRST_THROUGH,
    throughUpdateId: NEXT_THROUGH,
  });
  // The server serves after the continuation, past the first page's cursor,
  // which this page no longer stands on.
  await recordPage({
    continuation: "page-2",
    last: true,
    throughUpdateId: NEXT_THROUGH,
  });
  expect(await recordedCursor()).toBe(FIRST_THROUGH);
});

test("a pull held at an unsettled update leaves the cursor before it", async () => {
  await recordPage({ last: true, throughUpdateId: FIRST_THROUGH });
  await recordPage({
    held: true,
    last: true,
    sentCursor: FIRST_THROUGH,
    throughUpdateId: NEXT_THROUGH,
  });
  expect(await recordedCursor()).toBe(FIRST_THROUGH);
});
