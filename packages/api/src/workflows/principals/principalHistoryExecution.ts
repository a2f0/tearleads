import { AsyncLocalStorage } from "node:async_hooks";
import {
  type PrincipalHistoryPreparationBudget,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import {
  type PrincipalHistoryPreparationRequest,
  PrincipalHistoryPreparationRequired,
} from "./principalHistoryPreparationRequest";

const executions = new AsyncLocalStorage<PrincipalHistoryPreparationBudget>();

/** Installed only by a workflow that owns rollback before continuation. */
export function withBoundedPrincipalHistory<T>(
  work: () => Promise<T>,
): Promise<T> {
  return executions.run(principalHistoryPreparationBudget(), work);
}

export function principalHistoryExecutionBudget(): PrincipalHistoryPreparationBudget {
  return executions.getStore() ?? principalHistoryPreparationBudget();
}

export function requirePrincipalHistoryContinuation(
  request: PrincipalHistoryPreparationRequest,
): void {
  if (executions.getStore())
    throw new PrincipalHistoryPreparationRequired(request);
}

/** The predecessor is prepared before insertion; only its successor is reserved. */
export function withPrincipalHistorySuccessorStep<T>(
  work: () => Promise<T>,
): Promise<T> {
  if (!executions.getStore()) return work();
  return executions.run(
    { ...principalHistoryPreparationBudget(), remainingEntries: 1 },
    work,
  );
}
