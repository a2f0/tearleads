import { AsyncLocalStorage } from "node:async_hooks";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import {
  type PrincipalHistoryPreparationBudget,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import {
  type PrincipalHistoryPreparationRequest,
  PrincipalHistoryPreparationRequired,
} from "./principalHistoryPreparationRequest";

const executions = new AsyncLocalStorage<Set<string>>();

function headKey(head: ReferencedPrincipalHead): string {
  return JSON.stringify([
    head.principalType,
    head.principalId,
    head.version,
    head.stateHash,
  ]);
}

/** Installed only by a workflow that owns rollback before continuation. */
export function withBoundedPrincipalHistory<T>(
  work: () => Promise<T>,
): Promise<T> {
  return executions.run(new Set(), work);
}

export function principalHistoryExecutionBudget(
  head: ReferencedPrincipalHead,
): PrincipalHistoryPreparationBudget {
  const successors = executions.getStore();
  const budget = principalHistoryPreparationBudget();
  if (!successors) return budget;
  if (successors.has(headKey(head))) return { ...budget, remainingEntries: 1 };
  // A final mutation reads prepared prefixes. Cold work happens after rollback,
  // so a later dependency cannot discard the only progress made this round.
  return { ...budget, acceptedEntries: 1, remainingEntries: 0 };
}

export function requirePrincipalHistoryContinuation(
  request: PrincipalHistoryPreparationRequest,
): void {
  if (executions.getStore())
    throw new PrincipalHistoryPreparationRequired(request);
}

/** The predecessor is prepared before insertion; only its successor is reserved. */
export function withPrincipalHistorySuccessorStep<T>(
  head: ReferencedPrincipalHead,
  work: () => Promise<T>,
): Promise<T> {
  // Keep the issued allowance for later verification of this same head as an
  // Admins authority in the transaction's organization-policy successor.
  executions.getStore()?.add(headKey(head));
  return work();
}
