import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { documentVerdictJudge } from "../../../src/data/documents/shared/sync/documentUpdateVerdict";
import { sqlDocumentsPersistence } from "../../../src/data/persistence/documents/documentsPersistence";
import { DocumentRecordRepository } from "../../../src/data/persistence/documents/records";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import { createRemoteHistoryFixture } from "../../../src/stores/documents/documentStore/documentStore.testFixtures";
import {
  type DocumentHistory,
  type DocumentHistoryVerificationOptions,
  type DocumentsWorkflowRuntime,
  verifyDocumentHistory,
} from "../../../src/workflows/documents";
import { installFakeWebLocks } from "../data/fakeWebLocks";

/** The ids of the two ordinary updates `createRemoteHistoryFixture` serves. */
export const FIRST_UPDATE_ID = "550e8400-e29b-41d4-a716-446655440441";
export const SECOND_UPDATE_ID = "550e8400-e29b-41d4-a716-446655440442";

/**
 * A database, the two-update remote history, and Web Locks, so the
 * verifier's pages open read windows as a browser tab's would.
 */
export async function openHistoryVerificationBench(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  const removeWebLocks = installFakeWebLocks();
  await sqlDocumentsPersistence.ensureSchema(execSql);
  return {
    close() {
      removeWebLocks();
      close();
    },
    execSql,
    fixture: await createRemoteHistoryFixture(),
  };
}

export function verifyHistory(
  runtime: DocumentsWorkflowRuntime,
  localId: string,
  options?: DocumentHistoryVerificationOptions,
) {
  return verifyDocumentHistory({
    localId,
    options,
    runtime,
    stillCurrent: () => true,
  });
}

/** The text a replay ends at. */
export function finalText(history: DocumentHistory): string {
  return history.viewAt(history.stops.length - 1).text;
}

/**
 * Everything durable a verification could have changed: the record, the
 * local history, the sync cursor, void rows and their attempts, read
 * windows, isolation, rotation deaths, and recorded sync failures.
 */
export async function readDurableDocumentState(
  execSql: ExecSql,
  localId: string,
) {
  return {
    history: await sqlDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      localId,
    ),
    isolation: await execSql("SELECT * FROM document_loro_isolation"),
    progress: await execSql("SELECT * FROM document_sync_progress"),
    record: await sqlDocumentsPersistence.loadDocument(execSql, localId),
    rotation: await execSql("SELECT * FROM document_rotation_availability"),
    terminalFailures: await new DocumentRecordRepository(
      execSql,
    ).hasRecordedTerminalSyncFailures(),
    voids: await execSql(
      "SELECT * FROM document_void_updates ORDER BY update_id",
    ),
    windows: await execSql("SELECT * FROM document_loro_windows"),
  };
}

/** A void row as an earlier sync pass of this device would have recorded it. */
export async function recordVoidRow(
  execSql: ExecSql,
  row: {
    readonly attempts?: number;
    readonly documentId: string;
    readonly localId: string;
    readonly stage: "loro_import" | "loro_runtime";
    readonly updateId: string;
  },
): Promise<void> {
  await execSql(
    `INSERT INTO document_void_updates (app_kind, local_id, document_id,
       update_id, stage, message, attempts, judge, voided_at)
     VALUES ('documents', ?, ?, ?, ?, 'recorded by an earlier pass', ?, ?,
       '2026-11-25T00:00:00.000Z')`,
    [
      row.localId,
      row.documentId,
      row.updateId,
      row.stage,
      row.attempts ?? null,
      documentVerdictJudge(),
    ],
  );
}

/**
 * Serves `pages` of updates in order, one per raw request, each naming the
 * next by cursor. `total` is the update count the first page reports.
 */
export function servePages(
  pages: readonly DocumentSyncResponse["updates"][],
  total = pages.reduce((count, page) => count + page.length, 0),
) {
  const requests: DocumentSyncRequest[] = [];
  const lastId = pages.flat().at(-1)?.id ?? null;
  return {
    requests,
    responseForRequest(
      request: DocumentSyncRequest,
      response: DocumentSyncResponse,
    ): DocumentSyncResponse {
      requests.push(request);
      const index =
        request.pullCursor === undefined
          ? 0
          : Number(request.pullCursor.replace("page-", ""));
      const hasMore = index + 1 < pages.length;
      return {
        ...response,
        pullPage: {
          hasMore,
          nextCursor: hasMore ? `page-${index + 1}` : null,
          throughUpdateCount: total,
          throughUpdateId: total === 0 ? null : lastId,
        },
        updates: [...(pages[index] ?? [])],
      };
    },
  };
}
