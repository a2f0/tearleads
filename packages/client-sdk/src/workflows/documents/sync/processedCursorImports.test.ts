import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { recordDocumentSyncVerdictsInTransaction } from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { judgeDocumentSyncImports } from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "judged" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440c00";
const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440c01";
const EMPTY_RESPONSE = { updates: [] } as unknown as DocumentSyncResponse;

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`imports-${crypto.randomUUID()}`);
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

async function recordVoid(input: { judge: string; stage: string }) {
  await recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: input.judge,
      now: "2026-11-22T00:00:01.000Z",
      scope: SCOPE,
      voids: [
        {
          attempts: null,
          message: "first verdict",
          stage: input.stage,
          updateId: UPDATE_ID,
        },
      ],
    },
  );
}

/** Judges an update that would join, so a void can only come from a row. */
async function judge(): Promise<string[]> {
  const source = await createDocument("imports-source");
  source.getText("text").update("would join");
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  const verdicts = await judgeDocumentSyncImports({
    currentDocument: await createDocument("imports-current"),
    documentId: DOCUMENT_ID,
    execSql,
    result: {
      decryptedUpdates: [
        { id: UPDATE_ID, ...getUpdateVersionVectors(data), updateData: data },
      ],
      response: EMPTY_RESPONSE,
    },
    scope: SCOPE,
  });
  return verdicts.voided.map((voided) => voided.updateId);
}

async function storedMessage(): Promise<unknown> {
  const [row] = await execSql(
    "SELECT message FROM document_void_updates WHERE update_id = ?",
    [UPDATE_ID],
  );
  if (!row) return undefined;
  const { message } = row;
  return message;
}

test("an import void recorded under the running judge is not imported again", async () => {
  await recordVoid({ judge: documentVerdictJudge(), stage: "loro_import" });
  expect(await judge()).toEqual([UPDATE_ID]);

  // Recording the verdict again keeps the reason it was first voided for.
  await recordVoid({ judge: documentVerdictJudge(), stage: "loro_import" });
  await recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: documentVerdictJudge(),
      now: "2026-11-22T00:00:02.000Z",
      scope: SCOPE,
      voids: [
        {
          attempts: null,
          message: "this device already voided the update",
          stage: "loro_import",
          updateId: UPDATE_ID,
        },
      ],
    },
  );
  expect(await storedMessage()).toBe("first verdict");
});

test("a metadata void recorded under the running judge is not read again", async () => {
  await recordVoid({ judge: documentVerdictJudge(), stage: "loro_metadata" });
  expect(await judge()).toEqual([UPDATE_ID]);
});

test("an update voided under another judge, or at a stage the import judge does not decide, is judged again", async () => {
  await recordVoid({
    judge: "void-rules-0:loro-crdt@0.0.0",
    stage: "loro_import",
  });
  expect(await judge()).toEqual([]);

  await execSql("DELETE FROM document_void_updates");
  await recordVoid({
    judge: documentVerdictJudge(),
    stage: "plaintext_integrity",
  });
  expect(await judge()).toEqual([]);
});

test("a void judged again at another stage takes that stage and its reason", async () => {
  await recordVoid({
    judge: "void-rules-0:loro-crdt@0.0.0",
    stage: "loro_metadata",
  });
  // A newer decoder reads the update's metadata and voids it at the import.
  await recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: documentVerdictJudge(),
      now: "2026-11-22T00:00:02.000Z",
      scope: SCOPE,
      voids: [
        {
          attempts: null,
          message: "depends on operations no update carries",
          stage: "loro_import",
          updateId: UPDATE_ID,
        },
      ],
    },
  );

  expect(await storedMessage()).toBe("depends on operations no update carries");
  expect(await judge()).toEqual([UPDATE_ID]);
});
