import { afterEach, beforeEach, expect, test } from "bun:test";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportAllUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPendingUpdateFields } from "../../../documents/documentSync";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { sqlDocumentsPersistence } from "../documentsPersistence";
import { DocumentRecordRepository } from "./documentRecordRepository";
import {
  type DocumentPeerRebaseInstall,
  installDocumentPeerRebase,
} from "./peerRebaseInstall";

const LOCAL_ID = "note";
const SCOPE = { appKind: "documents", localId: LOCAL_ID };

let execSql: ExecSql;
let close: () => void;

beforeEach(async () => {
  ({ close, execSql } = await createTestExecSql("peer-rebase-install"));
  await sqlDocumentsPersistence.ensureSchema(execSql);
});

afterEach(() => close());

/** A record with one queued update, and a fork that would replace it. */
async function installCandidate(): Promise<
  Extract<DocumentPeerRebaseInstall, { kind: "fork" }>
> {
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, recovery_generation, updated_at)
     VALUES ('documents', ?, 'remote-note', 2, '2026-11-23')`,
    [LOCAL_ID],
  );
  const queuedDoc = await createDocument("queued-writer");
  queuedDoc.getText("text").insert(0, "queued");
  queuedDoc.commit();
  const queued = createPendingUpdateFields(exportAllUpdates(queuedDoc));
  if (!queued) throw new Error("expected a queued update");
  await new DocumentRecordRepository(execSql).enqueueDocumentPendingUpdate(
    SCOPE,
    queued,
  );
  const fork = await createDocument("fork");
  fork.import(exportAllUpdates(queuedDoc));
  fork.getText("text").insert(6, "!");
  fork.commit();
  const pendingUpdate = createPendingUpdateFields(exportAllUpdates(fork));
  if (!pendingUpdate) throw new Error("expected the fork's update");
  return {
    kind: "fork",
    queuedUpdateIds: await queuedUpdateIds(),
    checkpoint: {
      endVersionVector: encodeVersionVector(fork),
      snapshot: "c25hcHNob3Q=",
    },
    expectedDocumentId: "remote-note",
    expectedRecoveryGeneration: 2,
    pendingUpdate,
    readVersion: encodeVersionVector(queuedDoc),
    record: { kind: "document", peerSalt: "salt" },
    scope: SCOPE,
    stillCurrent: () => true,
  };
}

async function queuedUpdateIds(): Promise<string[]> {
  const rows = await execSql(
    "SELECT update_id FROM document_history_updates WHERE local_id = ? AND update_id IS NOT NULL",
    [LOCAL_ID],
  );
  return rows.map(({ update_id }) => String(update_id));
}

async function storedState() {
  const [record] = await execSql(
    "SELECT recovery_generation, peer_salt, pending_base_version FROM documents WHERE local_id = ?",
    [LOCAL_ID],
  );
  const rows = await execSql(
    "SELECT update_data, origin, update_id IS NOT NULL AS queued FROM document_history_updates WHERE local_id = ?",
    [LOCAL_ID],
  );
  const checkpoints = await execSql(
    "SELECT end_version_vector FROM document_history_checkpoints WHERE local_id = ?",
    [LOCAL_ID],
  );
  return { checkpoints, record, rows };
}

async function verdictRows(): Promise<number> {
  const [{ count: voids } = {}] = await execSql(
    "SELECT COUNT(*) AS count FROM document_void_updates WHERE local_id = ?",
    [LOCAL_ID],
  );
  const [{ count: notices } = {}] = await execSql(
    "SELECT COUNT(*) AS count FROM document_peer_preemptions WHERE local_id = ?",
    [LOCAL_ID],
  );
  return Number(voids) + Number(notices);
}

test("replaces the record's history and queue with the fork", async () => {
  const candidate = await installCandidate();
  // The refused update's void row and preemption notice.
  await execSql(
    `INSERT INTO document_void_updates (app_kind, local_id, document_id,
       update_id, stage, message, judge, voided_at)
     VALUES ('documents', ?, 'remote-note', 'refused', 'pull', 'void',
       'judge', '2026-11-23')`,
    [LOCAL_ID],
  );
  await execSql(
    `INSERT INTO document_peer_preemptions (app_kind, local_id, document_id,
       update_id, peer_id, noticed_at)
     VALUES ('documents', ?, 'remote-note', 'refused', '11', '2026-11-23')`,
    [LOCAL_ID],
  );
  expect(await verdictRows()).toBe(2);

  expect(await installDocumentPeerRebase(execSql, candidate)).toBe(true);

  const stored = await storedState();
  expect(stored.record).toEqual({
    peer_salt: "salt",
    pending_base_version: candidate.checkpoint.endVersionVector,
    recovery_generation: 3,
  });
  expect(stored.rows).toEqual([
    {
      origin: "outbox",
      queued: 1,
      update_data: candidate.pendingUpdate.updateData,
    },
  ]);
  expect(stored.checkpoints).toEqual([
    { end_version_vector: candidate.checkpoint.endVersionVector },
  ]);
  expect(await verdictRows()).toBe(0);
});

test.each([
  [
    "a history row past what the rebase read",
    { readVersion: emptyVersionVector() },
  ],
  ["another recovery generation", { expectedRecoveryGeneration: 1 }],
  ["a queue the rebase never read", { queuedUpdateIds: [] }],
  ["another document identity", { expectedDocumentId: "other-note" }],
  ["a stale store", { stillCurrent: () => false }],
])("writes nothing against %s", async (_case, change) => {
  const candidate = await installCandidate();
  const before = await storedState();

  expect(
    await installDocumentPeerRebase(execSql, { ...candidate, ...change }),
  ).toBe(false);

  expect(await storedState()).toEqual(before);
});

test("writes nothing once another runtime settled a queued update the rebase read", async () => {
  const candidate = await installCandidate();
  const repository = new DocumentRecordRepository(execSql);
  for (const id of candidate.queuedUpdateIds) {
    await repository.settleDocumentPendingUpdate(id);
  }
  expect(await queuedUpdateIds()).toEqual([]);
  const before = await storedState();

  expect(await installDocumentPeerRebase(execSql, candidate)).toBe(false);

  expect(await storedState()).toEqual(before);
});

const COMMITTED = "Y29tbWl0dGVk";

/**
 * A record with a checkpoint, a queued edit in its history tail, and a
 * queued outbox update, and a relay that would replace both queued updates.
 */
async function relayCandidate(): Promise<DocumentPeerRebaseInstall> {
  const fork = await installCandidate();
  const edited = await createDocument("edit");
  edited.getText("text").insert(0, "edit");
  edited.commit();
  const edit = createPendingUpdateFields(exportAllUpdates(edited));
  if (!edit) throw new Error("expected a queued edit");
  await new DocumentRecordRepository(
    execSql,
  ).enqueueDocumentPendingUpdateWithHistory(SCOPE, edit);
  await execSql(
    `INSERT INTO document_history_checkpoints (app_kind, local_id, snapshot,
       end_version_vector, revision, updated_at)
     VALUES ('documents', ?, 'c25hcHNob3Q=', ?, 'revision', '2026-11-23')`,
    [LOCAL_ID, emptyVersionVector()],
  );
  await execSql(
    `INSERT INTO document_void_updates (app_kind, local_id, document_id,
       update_id, stage, message, judge, voided_at)
     VALUES ('documents', ?, 'remote-note', 'voided', 'pull', 'void',
       'judge', '2026-11-23')`,
    [LOCAL_ID],
  );
  // The relay read every durable row, so its version covers them all.
  const relayed = await createDocument("relay");
  const rows = await execSql(
    "SELECT update_data FROM document_history_updates WHERE local_id = ?",
    [LOCAL_ID],
  );
  for (const { update_data } of rows) {
    relayed.import(base64ToBytes(String(update_data)));
  }
  const pendingUpdate = createPendingUpdateFields(exportAllUpdates(relayed));
  if (!pendingUpdate) throw new Error("expected the relay's update");
  return {
    expectedDocumentId: fork.expectedDocumentId,
    expectedRecoveryGeneration: fork.expectedRecoveryGeneration,
    kind: "relay",
    pendingUpdate: { ...pendingUpdate, committedVersionVector: COMMITTED },
    queuedUpdateIds: await queuedUpdateIds(),
    readVersion: encodeVersionVector(relayed),
    scope: SCOPE,
    stillCurrent: () => true,
  };
}

async function queueRows() {
  return execSql(
    `SELECT update_data, origin, update_id IS NOT NULL AS queued,
       committed_version_vector
     FROM document_history_updates WHERE local_id = ? ORDER BY rowid`,
    [LOCAL_ID],
  );
}

test("a relay replaces the queue and leaves the record and its history", async () => {
  const candidate = await relayCandidate();
  const before = await storedState();
  const [, edit] = await queueRows();
  expect(candidate.queuedUpdateIds).toHaveLength(2);

  expect(await installDocumentPeerRebase(execSql, candidate)).toBe(true);

  const stored = await storedState();
  expect(stored.record).toEqual(before.record);
  expect(stored.checkpoints).toEqual(before.checkpoints);
  expect(await verdictRows()).toBe(1);
  // The outbox update is dropped, the edit stays as unqueued history, and
  // the relay's update is the whole queue.
  expect(await queueRows()).toEqual([
    { ...edit, queued: 0 },
    {
      committed_version_vector: COMMITTED,
      origin: "outbox",
      queued: 1,
      update_data: candidate.pendingUpdate.updateData,
    },
  ]);
  const [queued] = await new DocumentRecordRepository(
    execSql,
  ).listDocumentPendingUpdates(SCOPE);
  expect(queued?.committedVersionVector).toBe(COMMITTED);
});

test.each([
  [
    "a history row past what the relay read",
    { readVersion: emptyVersionVector() },
  ],
  ["another recovery generation", { expectedRecoveryGeneration: 1 }],
  ["a queue the relay never read", { queuedUpdateIds: [] }],
  ["another document identity", { expectedDocumentId: "other-note" }],
  ["a stale store", { stillCurrent: () => false }],
])("a relay writes nothing against %s", async (_case, change) => {
  const candidate = await relayCandidate();
  const before = await queueRows();

  expect(
    await installDocumentPeerRebase(execSql, { ...candidate, ...change }),
  ).toBe(false);

  expect(await queueRows()).toEqual(before);
});

test("a relay writes nothing once another runtime queued an edit it never read", async () => {
  const candidate = await relayCandidate();
  const later = await createDocument("later");
  later.getText("text").insert(0, "later");
  later.commit();
  const fields = createPendingUpdateFields(exportAllUpdates(later));
  if (!fields) throw new Error("expected a later edit");
  await new DocumentRecordRepository(
    execSql,
  ).enqueueDocumentPendingUpdateWithHistory(SCOPE, fields);
  const before = await queueRows();

  expect(await installDocumentPeerRebase(execSql, candidate)).toBe(false);

  expect(await queueRows()).toEqual(before);
  expect(await queuedUpdateIds()).toHaveLength(3);
});
