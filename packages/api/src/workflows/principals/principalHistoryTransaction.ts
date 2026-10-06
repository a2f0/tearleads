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
import { principalHistoryContinuationProgress } from "./principalHistoryContinuationProgress";
import { withBoundedPrincipalHistory } from "./principalHistoryExecution";
import {
  type PrincipalHistoryPreparationRequest,
  PrincipalHistoryPreparationRequired,
} from "./principalHistoryPreparationRequest";
import { schedulePrincipalHistoryPreparation } from "./principalHistoryScheduler";
import { PrincipalPolicyError } from "./shared";

export class PrincipalHistoryContinuation extends Error {
  readonly code = "principal_history_preparation_pending";
  constructor(readonly progressToken: string) {
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
    return schedulePrincipalHistoryPreparation(db, error.request.head, () =>
      prepareContinuation(db, error.request),
    );
  }
}

async function prepareContinuation(
  db: ApiDatabase,
  request: PrincipalHistoryPreparationRequest,
): Promise<never> {
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
  const targetRequest = {
    ...request,
    head: target,
    retainedReferences: request.retainedReferences.filter(
      (reference) => reference.version <= target.version,
    ),
  };
  const before = await principalHistoryContinuationProgress(db, targetRequest);
  const budget = principalHistoryPreparationBudget();
  const prepared = await preparePrincipalHistory(db, {
    ...targetRequest,
    budget,
  });
  const progressToken = await principalHistoryContinuationProgress(
    db,
    prepared.complete ? targetRequest : prepared.request,
  );
  if (progressToken === before)
    throw new PrincipalPolicyError(
      "Principal history preparation made no progress",
      503,
    );
  throw new PrincipalHistoryContinuation(progressToken);
}
