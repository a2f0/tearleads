import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  getCurrentPrincipalState,
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import { withBoundedPrincipalHistory } from "./principalHistoryExecution";
import { PrincipalHistoryPreparationRequired } from "./principalHistoryPreparationRequest";
import { PrincipalPolicyError } from "./shared";

export class PrincipalHistoryContinuation extends Error {
  readonly code = "principal_history_preparation_pending";
  constructor() {
    super("Principal history preparation is pending; retry the same request");
    this.name = "PrincipalHistoryContinuation";
  }
}

/** A continuation is emitted only after the entire operation transaction rolls back. */
export async function runPrincipalHistoryTransaction<T>(
  db: ApiDatabase,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await withBoundedPrincipalHistory(() => db.transaction(work));
  } catch (error) {
    if (!(error instanceof PrincipalHistoryPreparationRequired)) throw error;
    const request = error.request;
    const committed = await getCurrentPrincipalState(
      request.head.principalType,
      request.head.principalId,
      db,
    );
    if (!committed)
      throw new PrincipalPolicyError(
        "Principal history preparation target is missing",
        409,
      );
    // A successor inserted in the rolled-back transaction does not exist here.
    // Prepare its committed predecessor. Prefix progress has an empty retained
    // selection; future citations are checked only when the retry recreates
    // the successor and passes its normal authorization and CAS checks.
    const target =
      request.head.version > committed.version
        ? committed
        : (await getPrincipalStatesForReferences([request.head], db)).get(
            principalStateReferenceKey(request.head),
          );
    if (!target)
      throw new PrincipalPolicyError(
        "Principal history preparation target changed",
        409,
      );
    await preparePrincipalHistory(db, {
      ...request,
      head: target,
      retainedReferences: request.retainedReferences.filter(
        (reference) => reference.version <= target.version,
      ),
      budget: principalHistoryPreparationBudget(),
    });
    throw new PrincipalHistoryContinuation();
  }
}
