import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  LoroRuntimeFailureLedger,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { createDocumentSyncLoroWindow } from "./loroPassWindow";
import { judgeDocumentSyncImports } from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "runtime" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440d00";
const UPDATE_ID = "550e8400-e29b-41d4-a716-446655440d01";
const EMPTY_RESPONSE = { updates: [] } as unknown as DocumentSyncResponse;

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`runtime-${crypto.randomUUID()}`);
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

/** An update whose payload traps the Loro runtime on every read. */
async function trapping() {
  const source = await createDocument("runtime-source");
  source.getText("text").update("would join");
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  const trap = { reads: 0 };
  const update: DecryptedDocumentSyncUpdate = {
    id: UPDATE_ID,
    ...getUpdateVersionVectors(data),
    get updateData(): Uint8Array {
      trap.reads += 1;
      throw new WebAssembly.RuntimeError("unreachable");
    },
  };
  return { trap, update };
}

/** One sync page judged in a new process. */
async function judgeInNewProcess(
  update: DecryptedDocumentSyncUpdate,
  reports: string[],
) {
  const currentDocument = await createDocument("runtime-reader");
  try {
    return await judgeDocumentSyncImports({
      loroWindow: createDocumentSyncLoroWindow(),
      currentDocument,
      documentId: DOCUMENT_ID,
      execSql,
      logError: (message) => {
        reports.push(String(message));
      },
      result: {
        contentKeyFingerprintsByEpoch: new Map(),
        decryptedUpdates: [update],
        response: EMPTY_RESPONSE,
      },
      runtimeLedger: new LoroRuntimeFailureLedger(),
      scope: SCOPE,
    });
  } finally {
    currentDocument.free();
  }
}

async function storedRow() {
  const [row] = await execSql(
    "SELECT stage, attempts FROM document_void_updates WHERE update_id = ?",
    [UPDATE_ID],
  );
  return row;
}

test("each lifetime's runtime failure is recorded as it happens, and the last one voids the update for good", async () => {
  const { trap, update } = await trapping();
  const reports: string[] = [];
  for (let attempt = 1; attempt < MAX_LORO_RUNTIME_ATTEMPTS; attempt += 1) {
    const verdicts = await judgeInNewProcess(update, reports);
    expect(verdicts.heldUpdateIds).toEqual([UPDATE_ID]);
    expect(verdicts.voided).toEqual([]);
    expect(await storedRow()).toEqual({
      attempts: attempt,
      stage: "loro_runtime",
    });
  }

  const final = await judgeInNewProcess(update, reports);
  expect(final.voided.map((entry) => entry.stage)).toEqual(["loro_runtime"]);
  expect(final.heldUpdateIds).toEqual([]);
  expect(await storedRow()).toEqual({
    attempts: MAX_LORO_RUNTIME_ATTEMPTS,
    stage: "loro_runtime",
  });
  expect(reports).toHaveLength(MAX_LORO_RUNTIME_ATTEMPTS);
  expect(reports.at(-1)).toContain("voided");

  // A void that final is not read again, in this process or any later one.
  const reads = trap.reads;
  const memoized = await judgeInNewProcess(update, reports);
  expect(memoized.voided.map((entry) => entry.stage)).toEqual(["loro_runtime"]);
  expect(trap.reads).toBe(reads);
});
