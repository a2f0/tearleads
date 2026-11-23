import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../sqlite/schema/documentRecordSchema";
import { type ExecSql, ensureSqlTables } from "../../../sqlite/sqlSchema";
import type { DocumentScope } from "./documentPersistenceTypes";
import { RecordedAttachmentSlotRepository } from "./recordedAttachmentSlotPersistence";

const SCOPE = { appKind: "documents", localId: "doc-a" };
const OTHER_SCOPE = { appKind: "documents", localId: "doc-b" };
const DOCUMENT = "550e8400-e29b-41d4-a716-446655440a01";
const RELINKED = "550e8400-e29b-41d4-a716-446655440a02";
const SEEN_AT = "2026-11-23T00:00:00.000Z";

let close: () => void = () => undefined;
let execSql: ExecSql;
let slots: RecordedAttachmentSlotRepository;

async function bind(scope: DocumentScope, documentId: string) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES (?, ?, ?, '', ?)
     ON CONFLICT (app_kind, local_id)
     DO UPDATE SET document_id = excluded.document_id`,
    [scope.appKind, scope.localId, documentId, SEEN_AT],
  );
}

async function sightings(): Promise<unknown[]> {
  return execSql(
    `SELECT local_id, slot_id, document_id, seen_at
     FROM document_recorded_attachment_slots
     ORDER BY local_id, slot_id`,
  );
}

beforeEach(async () => {
  const database = await createTestExecSql(`recorded-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  slots = new RecordedAttachmentSlotRepository(execSql);
  await bind(SCOPE, DOCUMENT);
  await bind(OTHER_SCOPE, DOCUMENT);
});

afterEach(() => close());

test("a recorded slot is restored for its record until it is forgotten", async () => {
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["a", "b"],
  });
  await slots.record(OTHER_SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["a"],
  });
  expect((await slots.restore(SCOPE, DOCUMENT)).sort()).toEqual(["a", "b"]);

  await slots.forget(SCOPE, ["a"]);
  expect(await slots.restore(SCOPE, DOCUMENT)).toEqual(["b"]);
  // Another record's sightings are its own.
  expect(await slots.restore(OTHER_SCOPE, DOCUMENT)).toEqual(["a"]);
});

test("a slot seen again keeps its first time", async () => {
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["a"],
  });
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: "2026-11-23T00:00:01.000Z",
    slotIds: ["a"],
  });
  expect(await sightings()).toEqual([
    {
      document_id: DOCUMENT,
      local_id: SCOPE.localId,
      seen_at: SEEN_AT,
      slot_id: "a",
    },
  ]);
});

test("a record relinked to another document starts over", async () => {
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["a", "b"],
  });
  await bind(SCOPE, RELINKED);
  // A sighting in the new document replaces the old one's row for the slot.
  await slots.record(SCOPE, {
    documentId: RELINKED,
    seenAt: "2026-11-23T00:00:02.000Z",
    slotIds: ["a"],
  });
  expect(await slots.restore(SCOPE, RELINKED)).toEqual(["a"]);
  // The old document's other rows are gone, not merely skipped.
  expect(await sightings()).toEqual([
    {
      document_id: RELINKED,
      local_id: SCOPE.localId,
      seen_at: "2026-11-23T00:00:02.000Z",
      slot_id: "a",
    },
  ]);
});

test("a sighting for a record bound elsewhere is neither kept nor restored", async () => {
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["a"],
  });
  await bind(SCOPE, RELINKED);
  // A write queued by a store still on the old document arrives late.
  await slots.record(SCOPE, {
    documentId: DOCUMENT,
    seenAt: SEEN_AT,
    slotIds: ["b"],
  });
  expect(await slots.restore(SCOPE, DOCUMENT)).toEqual([]);
  // A record that no longer exists keeps nothing either.
  await slots.record(
    { appKind: "documents", localId: "gone" },
    { documentId: DOCUMENT, seenAt: SEEN_AT, slotIds: ["a"] },
  );
  expect(await sightings()).toEqual([
    {
      document_id: DOCUMENT,
      local_id: SCOPE.localId,
      seen_at: SEEN_AT,
      slot_id: "a",
    },
  ]);
});
