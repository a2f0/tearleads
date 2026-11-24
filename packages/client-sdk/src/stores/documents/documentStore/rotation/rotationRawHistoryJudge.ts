import {
  DOCUMENTS_APP_KIND,
  type DocumentSyncImportVerdicts,
  processLoroRuntimeFailures,
  readRecordedDocumentSyncVoids,
  recordUncursoredDocumentSyncVerdicts,
  type SyncRemoteDocumentResult,
  validateDocumentSyncUpdateImports,
} from "../../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "../state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { documentIncomingUpdateIsolationFailureHandler } from "../sync/syncShared";

/**
 * Rotation rebuilds the history from what its judge imports, so a void stays
 * out of it as a sync pass leaves it out, and the rebuilt history must still
 * equal the live one. An update held behind a Loro runtime failure fails the
 * rotation, which retries later; it records no runtime attempt. A rotation
 * lifts the rebuild budget, so it defers nothing.
 */
function assertRotationVerdictsSettled(
  verdicts: DocumentSyncImportVerdicts,
): DocumentSyncImportVerdicts {
  const [runtimeFailure] = verdicts.runtimeFailures;
  if (runtimeFailure) throw runtimeFailure.error;
  const [unjudged] = [...verdicts.heldUpdateIds, ...verdicts.deferredUpdateIds];
  if (unjudged !== undefined) {
    throw new Error(
      `Rotation raw-history recovery left update ${unjudged} unjudged; retry key rotation`,
    );
  }
  return verdicts;
}

/**
 * Whether a void is decided by the update alone, so every reader judging it
 * finds it void. An import void depends on the history it is judged against,
 * and this device's sync passes judged against its own, which may have
 * started from a baseline rather than from raw history.
 */
function isPayloadVoid(
  stage: SyncRemoteDocumentResult["voidedUpdates"][number]["stage"],
): boolean {
  return (
    stage === "decrypt" ||
    stage === "loro_metadata" ||
    stage === "plaintext_integrity"
  );
}

/**
 * The voids a rotation's raw pages found, recorded once the rebuilt history
 * proves equal to the live one. Each stays out of the rebuild, but only one
 * its payload alone decides is recorded and reported, as a sync pass would.
 * An update the rotation accepts deletes no void row.
 */
export class RotationRawHistoryVoids {
  private readonly pages: SyncRemoteDocumentResult[] = [];

  notePage(synced: SyncRemoteDocumentResult): void {
    // Recording reads the verdicts, not the page's payloads.
    this.pages.push({
      ...synced,
      decryptedUpdates: [],
      response: { ...synced.response, updates: [] },
    });
  }

  async record(input: {
    readonly generation: DocumentStoreSyncGeneration;
    readonly state: DocumentStoreState;
  }): Promise<void> {
    for (const page of this.pages) {
      await recordUncursoredDocumentSyncVerdicts({
        execSql: input.state.runtime.infra.execSql,
        isCurrent: () =>
          isDocumentStoreSyncGenerationCurrent(input.state, input.generation),
        logError: input.state.runtime.util.logError,
        scope: { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
        synced: {
          ...page,
          voidedUpdates: page.voidedUpdates.filter(({ stage }) =>
            isPayloadVoid(stage),
          ),
        },
      });
    }
  }
}

export function rotationIncomingUpdateIsolation(input: {
  currentDocument: DocumentState;
  generation: DocumentStoreSyncGeneration;
  state: DocumentStoreState;
}) {
  return {
    onIncomingUpdateIsolationFailure:
      documentIncomingUpdateIsolationFailureHandler(
        input.state,
        input.generation,
      ),
    validateIncomingUpdates: async (
      result: Pick<SyncRemoteDocumentResult, "decryptedUpdates" | "response">,
    ) => {
      // A void this device recorded stays void without a Loro call, as in a
      // sync pass, so an update that failed the runtime for good is not
      // imported again. The judge records no runtime attempts, so its
      // failures count toward none. Checkpoints are judged with the stream,
      // as the rebuild imports them with it.
      const knownVoids = await readRecordedDocumentSyncVoids({
        execSql: input.state.runtime.infra.execSql,
        result,
        scope: { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
      });
      return assertRotationVerdictsSettled(
        await validateDocumentSyncUpdateImports({
          currentDocument: input.currentDocument,
          decryptedUpdates: result.decryptedUpdates,
          knownVoids,
          rebuildBudgetBytes: Number.POSITIVE_INFINITY,
          responseUpdates: result.response.updates,
          runtimeLedger: processLoroRuntimeFailures.unrecorded(),
        }),
      );
    },
  };
}
