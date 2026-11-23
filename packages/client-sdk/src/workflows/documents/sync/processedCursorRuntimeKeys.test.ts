import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type {
  DecryptedDocumentSyncUpdate,
  SyncRemoteDocumentResult,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  LoroRuntimeFailureLedger,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  judgeDocumentSyncImports,
  recordDocumentSyncVerdicts,
} from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "runtime-keys" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e00";
const TRAP_ID = "550e8400-e29b-41d4-a716-446655440e01";
const OLD_KEY_VOID_ID = "550e8400-e29b-41d4-a716-446655440e02";
const SENT_CURSOR = "550e8400-e29b-41d4-a716-446655440e03";
const THROUGH = "550e8400-e29b-41d4-a716-446655440e04";
const FINGERPRINTS = new Map([[1, "current-key"]]);

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`keys-${crypto.randomUUID()}`);
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

async function insertVoid(row: {
  readonly attempts: number | null;
  readonly epoch: number | null;
  readonly fingerprint: string | null;
  readonly stage: string;
  readonly updateId: string;
}): Promise<void> {
  await execSql(
    `INSERT INTO document_void_updates (app_kind, local_id, document_id,
       update_id, stage, message, attempts, judge, content_key_epoch,
       key_fingerprint, voided_at)
     VALUES (?, ?, ?, ?, ?, 'earlier', ?, ?, ?, ?, '2026-11-22T00:00:00.000Z')`,
    [
      SCOPE.appKind,
      SCOPE.localId,
      DOCUMENT_ID,
      row.updateId,
      row.stage,
      row.attempts,
      documentVerdictJudge(),
      row.epoch,
      row.fingerprint,
    ],
  );
}

/** An update whose payload traps the Loro runtime on every read. */
async function trapping(): Promise<DecryptedDocumentSyncUpdate> {
  const source = await createDocument("runtime-keys-source");
  source.getText("text").update("would join");
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  return {
    id: TRAP_ID,
    ...getUpdateVersionVectors(data),
    get updateData(): Uint8Array {
      throw new WebAssembly.RuntimeError("unreachable");
    },
  };
}

test("a final runtime failure leaves a key conflict for its page's save, which clears the cursor", async () => {
  // A cursor, one void judged under a key this pass no longer holds, and an
  // update that has failed the runtime in every lifetime but one.
  await execSql(
    `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
       through_update_id, through_version, judge)
     VALUES (?, ?, ?, ?, '', ?)`,
    [
      SCOPE.appKind,
      SCOPE.localId,
      DOCUMENT_ID,
      SENT_CURSOR,
      documentVerdictJudge(),
    ],
  );
  await insertVoid({
    attempts: null,
    epoch: 1,
    fingerprint: "earlier-key",
    stage: "loro_import",
    updateId: OLD_KEY_VOID_ID,
  });
  await insertVoid({
    attempts: MAX_LORO_RUNTIME_ATTEMPTS - 1,
    epoch: null,
    fingerprint: null,
    stage: "loro_runtime",
    updateId: TRAP_ID,
  });

  const currentDocument = await createDocument("runtime-keys-reader");
  const update = await trapping();
  const verdicts = await judgeDocumentSyncImports({
    currentDocument,
    documentId: DOCUMENT_ID,
    execSql,
    result: {
      contentKeyFingerprintsByEpoch: FINGERPRINTS,
      decryptedUpdates: [update],
      response: { updates: [] } as unknown as DocumentSyncResponse,
    },
    runtimeLedger: new LoroRuntimeFailureLedger(),
    scope: SCOPE,
  });
  currentDocument.free();
  expect(verdicts.voided.map(({ updateId }) => updateId)).toEqual([TRAP_ID]);

  // The page's save: the first and last page of a pull sent with the cursor.
  const synced = {
    contentKeyFingerprintsByEpoch: FINGERPRINTS,
    decryptedUpdates: [],
    hasHeldPull: false,
    hasIncompletePull: false,
    plan: {
      documentId: DOCUMENT_ID,
      request: { processedThroughUpdateId: SENT_CURSOR },
    },
    response: { pullPage: { throughUpdateId: THROUGH } },
    voidedUpdates: verdicts.voided,
  } as unknown as SyncRemoteDocumentResult;
  const outcome = await recordDocumentSyncVerdicts(execSql, {
    scope: SCOPE,
    synced,
  });

  // The void judged under the earlier key is judged again: the pull by
  // version alone that follows serves it.
  expect(outcome.cursorCleared).toBe(true);
  expect(
    await execSql(
      "SELECT through_update_id FROM document_sync_progress WHERE local_id = ?",
      [SCOPE.localId],
    ),
  ).toEqual([]);
  expect(
    await execSql(
      "SELECT update_id FROM document_void_updates WHERE update_id = ?",
      [OLD_KEY_VOID_ID],
    ),
  ).toEqual([]);
});
