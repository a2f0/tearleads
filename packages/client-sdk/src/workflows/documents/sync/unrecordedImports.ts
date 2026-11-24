import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentSyncImportVerdicts } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import type { LoroLifetimes } from "../../../data/documents/shared/sync/loroLifetime";
import { processLoroRuntimeFailures } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import type { LoroWindowKind } from "../../../data/documents/shared/sync/loroWindowMachine";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentSyncLoroWindow,
  noteDocumentSyncLoroWindowVerdicts,
  openDocumentSyncLoroWindow,
} from "./loroPassWindow";
import { readRecordedDocumentSyncVoids } from "./processedCursor";

/**
 * Judges served updates for work that records no runtime attempts: a
 * rotation's raw history and a founding view. A trap there fails the work,
 * which retries later. An update the scope voided for good stays void
 * without a Loro call, and the reads run inside `loroWindow`, so a payload
 * that ends the process there is found by the next lifetime: a founding
 * view's `read` window counts it as a sync pass's would, and a rotation's
 * `rotation` window counts it toward the rotation instead. The caller
 * settles the window once its Loro work on the page is over, which clears
 * the attempts of the updates it survived (#3194).
 */
export async function judgeUnrecordedDocumentSyncImports(input: {
  readonly currentDocument: Parameters<
    typeof validateDocumentSyncUpdateImports
  >[0]["currentDocument"];
  readonly documentId: string;
  readonly execSql: ExecSql;
  /** What a death in the window is charged to; `read` by default. */
  readonly kind?: LoroWindowKind | undefined;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly loroWindow: DocumentSyncLoroWindow;
  readonly rebuildBudgetBytes?: number | undefined;
  readonly result: Pick<
    SyncRemoteDocumentResult,
    "decryptedUpdates" | "response"
  >;
  readonly scope: DocumentScope;
}): Promise<DocumentSyncImportVerdicts> {
  const knownVoids = await readRecordedDocumentSyncVoids(input);
  const ledger = processLoroRuntimeFailures.unrecorded();
  const verdicts = await validateDocumentSyncUpdateImports({
    beforeUpdateReads: () =>
      openDocumentSyncLoroWindow({
        ...input,
        knownVoids,
        ledger,
        window: input.loroWindow,
      }),
    currentDocument: input.currentDocument,
    decryptedUpdates: input.result.decryptedUpdates,
    knownVoids,
    lifetimes: input.lifetimes,
    rebuildBudgetBytes: input.rebuildBudgetBytes,
    responseUpdates: input.result.response.updates,
    runtimeLedger: ledger,
  });
  noteDocumentSyncLoroWindowVerdicts(input.loroWindow, verdicts);
  return verdicts;
}
