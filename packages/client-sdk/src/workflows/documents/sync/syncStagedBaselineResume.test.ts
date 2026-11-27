// Durable staged baseline resume across process restarts (#3238 step 5).
// Wrapping the same SQLite database in a fresh `ExecSql` closure simulates a
// process restart: `getOrCreateStagedBaselineUploads` starts with an empty
// in-memory registry and must hydrate from `document_staged_baseline_uploads`.
import {
  afterEach,
  beforeEach,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DOCUMENT_BASELINE_STAGE_ERROR_CODES as STAGE,
} from "@tearleads/validators/response";
import {
  createLongHistoryDocument,
  createStagedHealHarness,
  STAGED_BASELINE_TEST_TIMEOUT_MS,
} from "../../../../test/helpers/workflows/stagedBaselineHeal";
import { createStagedUnlinkHarness } from "../../../../test/helpers/workflows/stagedBaselineUnlink";
import {
  DocumentRecordRepository,
  ensureDocumentTables,
} from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { openPastOrphanedStages } from "../baselineStage/stagedBaselineOrphans";
import { getOrCreateStagedBaselineUploads } from "../baselineStage/stagedBaselineUploads";

setDefaultTimeout(STAGED_BASELINE_TEST_TIMEOUT_MS);

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-staged-resume",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

/** A fresh ExecSql handle over the same SQLite database (new process memory). */
function restartProcess(underlying: ExecSql): ExecSql {
  return ((sql, bind, rowMode) =>
    underlying(sql, bind, rowMode as never)) as ExecSql;
}

interface PersistedUploadRow {
  baseline_id: string;
  document_id: string;
  headers_signed_for: string | null;
}

async function persistedUploadRows(db: ExecSql): Promise<PersistedUploadRow[]> {
  return (await db(
    "SELECT document_id, baseline_id, headers_signed_for FROM document_staged_baseline_uploads",
  )) as unknown as PersistedUploadRow[];
}

test("restart mid-stage resumes a heal from the server-acknowledged index", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("resume-heal");

  // Crash right after segment 4 lands on the server (lost answer).
  server.loseNextAnswer("stage:4");
  expect(await harness.heal(document, execSql)).toBeNull();
  const stageBefore = server.stage(documentId);
  expect(stageBefore?.segments).toHaveLength(5);
  expect(await persistedUploadRows(execSql)).toHaveLength(1);

  const callsBefore = server.calls.length;
  const restarted = restartProcess(execSql);
  const synced = await harness.heal(document, restarted);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const callsAfter = server.calls.slice(callsBefore);
  // Resumed via GET, never reopened, never re-uploaded segments 0..4.
  expect(callsAfter[0]).toBe("get");
  expect(callsAfter).not.toContain("open");
  expect(callsAfter).not.toContain("stage:0");
  expect(callsAfter).not.toContain("stage:4");
  expect(callsAfter[1]).toBe("stage:5");
  expect(harness.requests[0]?.baselineStageId).toBe(stageBefore?.baselineId);
  expect(await persistedUploadRows(restarted)).toEqual([]);
});

test("restart after a crash before a segment reached the server resumes at that index", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("resume-unacked");

  // Segment 4 is persisted locally before PUT, then fails before reaching server.
  server.refuseNext("stage:4", {
    message: "network dropped before server received segment",
    status: null,
  });
  expect(await harness.heal(document, execSql)).toBeNull();
  expect(server.stage(documentId)?.segments).toHaveLength(4);

  const callsBefore = server.calls.length;
  const restarted = restartProcess(execSql);
  const synced = await harness.heal(document, restarted);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const callsAfter = server.calls.slice(callsBefore);
  expect(callsAfter[0]).toBe("get");
  expect(callsAfter).not.toContain("open");
  expect(callsAfter).not.toContain("stage:3");
  expect(callsAfter[1]).toBe("stage:4");
  expect(await persistedUploadRows(restarted)).toEqual([]);
});

test("restart mid-unlink resumes the same unlink and still blocks a different container unlink from reusing the key", async () => {
  const harness = await createStagedUnlinkHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("resume-unlink");

  server.loseNextAnswer("stage:4");
  expect(await harness.unlink(document, execSql)).toBeNull();
  const stageBefore = server.stage(documentId);
  expect(stageBefore?.segments).toHaveLength(5);

  // Same unlink after restart: reuses persisted key, signed event, and stage.
  const callsBefore = server.calls.length;
  const restarted = restartProcess(execSql);
  const unlinked = await harness.unlink(document, restarted);
  expect(unlinked?.contentKeyRotated).toBe(true);
  const callsAfter = server.calls.slice(callsBefore);
  expect(callsAfter[0]).toBe("get");
  expect(callsAfter).not.toContain("open");
  expect(callsAfter).not.toContain("stage:4");
  expect(callsAfter[1]).toBe("stage:5");
  expect(harness.requests[0]?.baselineStageId).toBe(stageBefore?.baselineId);
  expect(await persistedUploadRows(restarted)).toEqual([]);

  // Now stage an unlink of child on a fresh database, restart, and unlink
  // parent instead: the persisted keyTargets fence must force a fresh key
  // and stage.
  const db2 = await createTestExecSql("document-sync-staged-resume-fence");
  try {
    await ensureDocumentTables(db2.execSql);
    const harness2 = await createStagedUnlinkHarness();
    const doc2 = await createLongHistoryDocument("resume-unlink-fence");
    harness2.server.loseNextAnswer("stage:3");
    expect(await harness2.unlink(doc2, db2.execSql)).toBeNull();
    const stage2Before = harness2.server.stage(harness2.documentId);
    expect(stage2Before?.segments).toHaveLength(4);

    const calls2Before = harness2.server.calls.length;
    const restarted2 = restartProcess(db2.execSql);
    const unlinkedParent = await harness2.unlink(doc2, restarted2, {
      container: "parent",
    });
    expect(unlinkedParent?.contentKeyRotated).toBe(true);
    expect(harness2.requests[0]?.baselineStageId).not.toBe(
      stage2Before?.baselineId,
    );
    expect(harness2.server.calls.slice(calls2Before, calls2Before + 3)).toEqual(
      ["abandon", "open", "stage:0"],
    );
    expect(await persistedUploadRows(restarted2)).toEqual([]);
  } finally {
    db2.close();
  }
}, 60_000);

test("restart after server expiry or drop clears persisted state and opens a fresh stage", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("resume-expired");

  server.loseNextAnswer("stage:3");
  expect(await harness.heal(document, execSql)).toBeNull();
  const oldBaselineId = server.stage(documentId)?.baselineId;
  server.expire(documentId);

  const restarted = restartProcess(execSql);
  const synced = await harness.heal(document, restarted);
  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(harness.requests[0]?.baselineStageId).not.toBe(oldBaselineId);
  expect(await persistedUploadRows(restarted)).toEqual([]);
});

test("restart after headers_stale re-signs staged headers without re-uploading segments", async () => {
  const harness = await createStagedHealHarness();
  const { server } = harness;
  const document = await createLongHistoryDocument("resume-resign");

  harness.script.refuse = (_request, ordinal) =>
    ordinal === 1
      ? {
          baselineStageCode: STAGE.headersStale,
          code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
          message: "staged write headers are stale",
          status: 409,
        }
      : null;
  // First pass commits once -> headers_stale triggers in-pass replan; stop it
  // right on resign:0 so the persisted headers_signed_for = null survives restart.
  server.refuseNext("resign:0", { message: "transient outage", status: 503 });
  expect(await harness.heal(document, execSql)).toBeNull();
  const [row] = await persistedUploadRows(execSql);
  expect(row?.headers_signed_for).toBeNull();

  harness.script.refuse = null;
  const callsBefore = server.calls.length;
  const restarted = restartProcess(execSql);
  const synced = await harness.heal(document, restarted);

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  const callsAfter = server.calls.slice(callsBefore);
  expect(callsAfter[0]).toBe("get");
  expect(callsAfter).toContain("resign:0");
  expect(callsAfter).not.toContain("open");
  expect(callsAfter).not.toContain("stage:0");
  expect(await persistedUploadRows(restarted)).toEqual([]);
});

test("a corrupt persisted upload row fails closed and never bricks rotation", async () => {
  const harness = await createStagedHealHarness();
  const { documentId } = harness;
  const document = await createLongHistoryDocument("resume-corrupt");

  await execSql(
    `INSERT INTO document_staged_baseline_uploads (
      document_id, baseline_id, content_key_base64, content_key_commitment,
      content_key_epoch, link_set_event_json, signed_at, key_targets_json,
      headers_signed_for, records_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
    [
      documentId,
      "corrupt-baseline",
      "not-32-bytes",
      "0".repeat(64),
      2,
      "2026-07-26T00:00:00.000Z",
      "{bad-json",
      "{bad-json",
      "2026-07-26T00:00:00.000Z",
    ],
  );

  const restarted = restartProcess(execSql);
  const synced = await harness.heal(document, restarted);
  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(await persistedUploadRows(restarted)).toEqual([]);
});

test("a failed durable save before open prevents opening an untracked server stage", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("save-before-open");

  const failingExecSql = ((sql, bind, rowMode) => {
    if (
      sql.includes("document_staged_baseline_uploads") &&
      /insert/iu.test(sql)
    ) {
      return Promise.reject(new Error("sqlite disk full"));
    }
    return execSql(sql, bind, rowMode as never);
  }) as ExecSql;

  await expect(harness.heal(document, failingExecSql)).rejects.toThrow(
    "document_staged_baseline_uploads",
  );
  expect(server.calls).not.toContain("open");
  expect(
    getOrCreateStagedBaselineUploads(failingExecSql).get(documentId),
  ).toBeNull();
});

test("a restarted process still tracks persisted uploads as live and deletes them on record deletion", async () => {
  const harness = await createStagedHealHarness();
  const { documentId, server } = harness;
  const document = await createLongHistoryDocument("resume-tracked");

  server.loseNextAnswer("stage:2");
  expect(await harness.heal(document, execSql)).toBeNull();
  const stage = server.stage(documentId);
  if (!stage) throw new Error("Expected staged baseline");

  const restarted = restartProcess(execSql);
  const uploads = getOrCreateStagedBaselineUploads(restarted);
  await uploads.ensureLoaded();
  expect(uploads.tracks(documentId, stage.baselineId)).toBe(true);

  // Orphan cleanup must not abandon a stage that this database tracks after restart.
  const staleExpiry = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const callsBefore = server.calls.length;
  const opened = await openPastOrphanedStages(
    async () => ({
      code: STAGE.limitReached,
      message: "limit reached",
      ok: false,
      openStages: [
        {
          baselineId: stage.baselineId,
          documentId,
          expiresAt: staleExpiry,
        },
      ],
      status: 409,
    }),
    { api: server.api, uploads },
  );
  expect(opened.ok).toBe(false);
  expect(server.calls.slice(callsBefore)).toEqual([]);

  // Deleting the document record cleans up the persisted staged upload row.
  await restarted(
    `INSERT INTO documents (
      app_kind, local_id, document_id, access_epoch, effective_access_level,
      snapshot_end_version, updated_at
    ) VALUES ('documents', 'local-doc-1', ?, 1, 'write', '', '2026-07-26T00:00:00.000Z')`,
    [documentId],
  );
  await new DocumentRecordRepository(restarted).deleteDocumentRecord({
    appKind: "documents",
    localId: "local-doc-1",
  });
  expect(await persistedUploadRows(restarted)).toEqual([]);
});
