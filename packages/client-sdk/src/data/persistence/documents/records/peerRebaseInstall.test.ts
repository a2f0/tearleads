import { afterEach, beforeEach, expect, test } from "bun:test";
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
async function installCandidate(): Promise<DocumentPeerRebaseInstall> {
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
