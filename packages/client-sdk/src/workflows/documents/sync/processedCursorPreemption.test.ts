import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type { VoidedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  recordDocumentSyncVerdicts,
  reportDocumentSyncVoids,
} from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "preempted" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e00";
const FORGED = "550e8400-e29b-41d4-a716-446655440e01";
const PEER = "4242";

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`preempt-${crypto.randomUUID()}`);
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

function preemptingVoid(): VoidedDocumentSyncUpdate {
  const error = new DocumentSyncUpdateIsolationError({
    cause: new Error("reuses an already-covered frontier"),
    responseUpdate: {
      authorFingerprint: "forger-fingerprint",
      documentId: DOCUMENT_ID,
      id: FORGED,
      writeHeader: { contentKeyEpoch: 1, writerUserId: "forger-user" },
    } as unknown as DocumentSyncResponse["updates"][number],
    stage: "loro_import",
    updateId: FORGED,
  });
  return {
    error,
    preemptedPeerId: PEER,
    stage: "loro_import",
    updateId: FORGED,
  };
}

function synced(): SyncRemoteDocumentResult {
  return {
    decryptedUpdates: [],
    hasHeldPull: false,
    hasIncompletePull: false,
    plan: { documentId: DOCUMENT_ID, request: {} },
    response: { pullPage: { throughUpdateId: FORGED } },
    voidedUpdates: [preemptingVoid()],
  } as unknown as SyncRemoteDocumentResult;
}

test("a void that reused this device's operation ids leaves a notice and is reported once, naming its writer", async () => {
  const page = synced();
  const outcome = await recordDocumentSyncVerdicts(execSql, {
    scope: SCOPE,
    synced: page,
  });
  expect(outcome.newlyPreemptedUpdateIds).toEqual([FORGED]);
  expect(
    await execSql(
      `SELECT update_id, peer_id, writer_user_id, author_fingerprint
         FROM document_peer_preemptions`,
    ),
  ).toEqual([
    {
      author_fingerprint: "forger-fingerprint",
      peer_id: PEER,
      update_id: FORGED,
      writer_user_id: "forger-user",
    },
  ]);

  const reports: string[] = [];
  const logError = (message: string | Error) => {
    reports.push(String(message));
  };
  reportDocumentSyncVoids(logError, page, outcome);
  const notices = reports.filter((message) => message.includes(PEER));
  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("forger-user");
  expect(notices[0]).toContain("forger-fingerprint");

  // Served again (its void row churned meanwhile), it is not reported again.
  await execSql("DELETE FROM document_void_updates");
  const again = await recordDocumentSyncVerdicts(execSql, {
    scope: SCOPE,
    synced: synced(),
  });
  expect(again.newlyPreemptedUpdateIds).toEqual([]);
});
