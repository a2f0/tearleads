import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../../../../data/sqlite/schema/documentRecordSchema";
import {
  type ExecSql,
  ensureSqlTables,
} from "../../../../data/sqlite/sqlSchema";
import {
  listRemovedAttachmentSlots,
  observeRecordedAttachmentSlots,
} from "./removedSlotDetaches";

const LOCAL_ID = "doc-a";
const DOCUMENT = "550e8400-e29b-41d4-a716-446655440b01";
const RELINKED = "550e8400-e29b-41d4-a716-446655440b02";
const REMOVED = { slotIds: new Set<string>(), versionVector: "" };

let close: () => void = () => undefined;
let execSql: ExecSql;

async function bind(documentId: string) {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id,
       snapshot_end_version, updated_at)
     VALUES ('documents', ?, ?, '', '2026-11-23T00:00:00.000Z')
     ON CONFLICT (app_kind, local_id)
     DO UPDATE SET document_id = excluded.document_id`,
    [LOCAL_ID, documentId],
  );
}

/** The parts of a document store the sightings read, record mutable. */
function store(documentId: string | null) {
  return {
    attachmentStorageKeyBySlotId: {},
    localId: LOCAL_ID,
    pendingAttachments: [],
    record: { documentId },
    runtime: { infra: { execSql } },
  };
}

beforeEach(async () => {
  const database = await createTestExecSql(`sightings-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureSqlTables(execSql, documentTables);
  await bind(DOCUMENT);
});

afterEach(() => close());

test("a slot seen before the record had a server id is kept once it gets one", async () => {
  const before = store(null);
  observeRecordedAttachmentSlots(before, [{ slotId: "a" }]);
  before.record = { documentId: DOCUMENT };
  expect(
    await listRemovedAttachmentSlots(before, {
      slotIds: new Set(["a"]),
      versionVector: "",
    }),
  ).toEqual([]);

  // A store opened after a restart finds it.
  expect(await listRemovedAttachmentSlots(store(DOCUMENT), REMOVED)).toEqual([
    "a",
  ]);
});

test("a store relinked to another document starts over, in memory and on disk", async () => {
  const relinking = store(DOCUMENT);
  observeRecordedAttachmentSlots(relinking, [{ slotId: "a" }]);
  expect(await listRemovedAttachmentSlots(relinking, REMOVED)).toEqual(["a"]);
  await bind(RELINKED);
  relinking.record = { documentId: RELINKED };
  expect(await listRemovedAttachmentSlots(relinking, REMOVED)).toEqual([]);

  // Bound back, the record keeps nothing from its first link either.
  await bind(DOCUMENT);
  expect(await listRemovedAttachmentSlots(store(DOCUMENT), REMOVED)).toEqual(
    [],
  );
});
