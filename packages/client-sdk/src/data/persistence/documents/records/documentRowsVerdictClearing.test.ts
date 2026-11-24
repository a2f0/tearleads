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
import {
  writeLoroIsolationInTransaction,
  writeLoroWindowInTransaction,
} from "./loroWindowPersistence";
import { RecordedAttachmentSlotRepository } from "./recordedAttachmentSlotPersistence";
import { writeRotationAvailabilityInTransaction } from "./rotationAvailabilityPersistence";

const APP_KIND = "container-metadata";
const KEPT = "kept";
const CLEARED = "cleared";
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440f00";
const THROUGH = "550e8400-e29b-41d4-a716-446655440f01";
const LIAR = "550e8400-e29b-41d4-a716-446655440f02";

let close: () => void = () => undefined;
let execSql: ExecSql;

/**
 * A scope with a cursor, a void row, a preemption notice, a slot its store
 * saw recorded, a Loro read window and isolation a death left, and a
 * rotation death.
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
        throughUpdateCount: 1,
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
  const db = getClientSQLitePersistenceRuntime(execSql).db;
  await writeLoroWindowInTransaction(
    db,
    { appKind: APP_KIND, localId },
    {
      counts: false,
      documentId: DOCUMENT_ID,
      judge: "void-rules-1:loro-crdt@1.0.0",
      kind: "read",
      lifetimeId: "dead",
      updateIds: [THROUGH],
      windowId: "dead-window",
    },
    "2026-11-22T00:00:01.000Z",
  );
  await writeLoroIsolationInTransaction(
    db,
    { appKind: APP_KIND, localId },
    { status: "isolating", documentId: DOCUMENT_ID, suspects: [THROUGH] },
  );
  await writeRotationAvailabilityInTransaction(
    db,
    { appKind: APP_KIND, localId },
    {
      deaths: 1,
      documentId: DOCUMENT_ID,
      judge: "void-rules-1:loro-crdt@1.0.0",
      status: "dying",
    },
    "2026-11-22T00:00:01.000Z",
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
    isolation: await scopesWith("document_loro_isolation"),
    rotations: await scopesWith("document_rotation_availability"),
    sightings: await scopesWith("document_recorded_attachment_slots"),
    voids: await scopesWith("document_void_updates"),
    windows: await scopesWith("document_loro_windows"),
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
    isolation: [CLEARED, KEPT],
    notices: [CLEARED, KEPT],
    progress: [CLEARED, KEPT],
    rotations: [CLEARED, KEPT],
    sightings: [CLEARED, KEPT],
    voids: [CLEARED, KEPT],
    windows: [CLEARED, KEPT],
  });
});

afterEach(() => close());

test("rebinding a scope to another server document drops its cursor, voids, notices, sightings, Loro windows, and rotation deaths", async () => {
  await rebindDocumentRowInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    { appKind: APP_KIND, localId: CLEARED },
    {
      documentId: "550e8400-e29b-41d4-a716-446655440f09",
      updatedAt: "2026-11-22T00:00:02.000Z",
    },
  );
  expect(await judgedScopes()).toEqual({
    isolation: [KEPT],
    notices: [KEPT],
    progress: [KEPT],
    rotations: [KEPT],
    sightings: [KEPT],
    voids: [KEPT],
    windows: [KEPT],
  });
});

test("deleting a scope's rows drops its cursor, voids, notices, sightings, Loro windows, and rotation deaths", async () => {
  await deleteDocumentScopeRowsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    APP_KIND,
    [CLEARED],
  );
  expect(await judgedScopes()).toEqual({
    isolation: [KEPT],
    notices: [KEPT],
    progress: [KEPT],
    rotations: [KEPT],
    sightings: [KEPT],
    voids: [KEPT],
    windows: [KEPT],
  });
});
