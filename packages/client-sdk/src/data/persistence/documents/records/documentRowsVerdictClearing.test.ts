import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../../sqlite/sqlSchema";
import {
  deleteDocumentScopeRowsInTransaction,
  rebindDocumentRowInTransaction,
} from "./documentRowsInTransaction";
import { recordDocumentSyncVerdictsInTransaction } from "./documentSyncVerdictPersistence";
import { RecordedAttachmentSlotRepository } from "./recordedAttachmentSlotPersistence";

const APP_KIND = "container-metadata";
const KEPT = "kept";
const CLEARED = "cleared";
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440f00";
const THROUGH = "550e8400-e29b-41d4-a716-446655440f01";
const LIAR = "550e8400-e29b-41d4-a716-446655440f02";

let close: () => void = () => undefined;
let execSql: ExecSql;

/**
 * A scope with a cursor, a void row, a preemption notice, and a slot its
 * store saw recorded.
 */
async function judgedScope(localId: string) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES (?, ?, ?, '', '2026-11-22T00:00:00.000Z')`,
    [APP_KIND, localId, DOCUMENT_ID],
  );
  await recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: "void-rules-1:loro-crdt@1.0.0",
      now: "2026-11-22T00:00:01.000Z",
      preemptions: [
        {
          authorFingerprint: null,
          peerId: "7",
          updateId: LIAR,
          writerUserId: null,
        },
      ],
      pullPage: {
        first: true,
        held: false,
        last: true,
        sentCursor: null,
        throughUpdateId: THROUGH,
      },
      scope: { appKind: APP_KIND, localId },
      voids: [
        {
          attempts: null,
          message: "declared span is false",
          stage: "loro_import",
          updateId: LIAR,
        },
      ],
    },
  );
  await new RecordedAttachmentSlotRepository(execSql).record(
    { appKind: APP_KIND, localId },
    {
      documentId: DOCUMENT_ID,
      seenAt: "2026-11-22T00:00:01.000Z",
      slotIds: ["contact-photos:portrait"],
    },
  );
}

async function scopesWith(table: string): Promise<unknown[]> {
  const rows = await execSql(`SELECT local_id FROM ${table} ORDER BY local_id`);
  return rows.map(({ local_id: localId }) => localId);
}

async function judgedScopes() {
  return {
    notices: await scopesWith("document_peer_preemptions"),
    progress: await scopesWith("document_sync_progress"),
    sightings: await scopesWith("document_recorded_attachment_slots"),
    voids: await scopesWith("document_void_updates"),
  };
}

beforeEach(async () => {
  const database = await createTestExecSql(`clearing-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  await judgedScope(KEPT);
  await judgedScope(CLEARED);
  expect(await judgedScopes()).toEqual({
    notices: [CLEARED, KEPT],
    progress: [CLEARED, KEPT],
    sightings: [CLEARED, KEPT],
    voids: [CLEARED, KEPT],
  });
});

afterEach(() => close());

test("rebinding a scope to another server document drops its cursor, voids, notices, and sightings", async () => {
  await rebindDocumentRowInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    { appKind: APP_KIND, localId: CLEARED },
    {
      documentId: "550e8400-e29b-41d4-a716-446655440f09",
      updatedAt: "2026-11-22T00:00:02.000Z",
    },
  );
  expect(await judgedScopes()).toEqual({
    notices: [KEPT],
    progress: [KEPT],
    sightings: [KEPT],
    voids: [KEPT],
  });
});

test("deleting a scope's rows drops its cursor, voids, notices, and sightings", async () => {
  await deleteDocumentScopeRowsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    APP_KIND,
    [CLEARED],
  );
  expect(await judgedScopes()).toEqual({
    notices: [KEPT],
    progress: [KEPT],
    sightings: [KEPT],
    voids: [KEPT],
  });
});
