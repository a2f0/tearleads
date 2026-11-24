import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentSyncImportVerdicts } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import type { LoroLifetimes } from "../../../data/documents/shared/sync/loroLifetime";
import { processLoroRuntimeFailures } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type DocumentSyncLoroReads,
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
 * page of updates the device accepted counts it toward the rotation instead
 * (`DocumentSyncLoroReads`). The caller
 * settles the window once its Loro work on the page is over, which clears
 * the attempts of the updates it survived (#3194).
 */
export async function judgeUnrecordedDocumentSyncImports(input: {
  readonly currentDocument: Parameters<
    typeof validateDocumentSyncUpdateImports
  >[0]["currentDocument"];
  readonly documentId: string;
  readonly execSql: ExecSql;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly loroWindow: DocumentSyncLoroWindow;
  /**
   * Updates a rotation leaves out of its rebuild, unread, as a runtime void
   * it does not record (`rotationAvailabilityMachine.ts`).
   */
  readonly leftOut?: readonly string[] | undefined;
  /** What the page's reads are, and so what a death there is charged to. */
  readonly reads: DocumentSyncLoroReads;
  readonly rebuildBudgetBytes?: number | undefined;
  readonly result: Pick<
    SyncRemoteDocumentResult,
    "decryptedUpdates" | "response"
  >;
  readonly scope: DocumentScope;
}): Promise<DocumentSyncImportVerdicts> {
  const knownVoids = new Map(await readRecordedDocumentSyncVoids(input));
  for (const id of input.leftOut ?? []) knownVoids.set(id, "loro_runtime");
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
