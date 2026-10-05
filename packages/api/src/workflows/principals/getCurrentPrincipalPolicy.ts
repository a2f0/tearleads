import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import {
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
  type VerifiedPrincipalPolicyHistory,
  verifyPrincipalPolicyBundleAgainstHistory,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { beginPrincipalHistoryVerification } from "../../utils/principalHistoryWork";
import { preparePrincipalHistory } from "./preparePrincipalHistory";
import {
  principalHistoryExecutionBudget,
  requirePrincipalHistoryContinuation,
} from "./principalHistoryExecution";
import { principalHistoryError } from "./principalHistoryRecords";
import {
  buildPrincipalPolicyCurrentForStateWithExecutor,
  buildPrincipalPolicyForStateWithExecutor,
} from "./principalPolicyBundleRecords";

export interface VerifiedPrincipalPolicyCurrentBundle {
  readonly bundle: Omit<PrincipalPolicyBundleResponse, "previousStates">;
  readonly policy: VerifiedPrincipalPolicyCurrent;
}

export async function getVerifiedPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  retainedReferences: readonly ReferencedPrincipalHead[] = [],
): Promise<VerifiedPrincipalPolicyCurrentBundle> {
  const { bundle, policy } = await verifyCurrent(
    executor,
    currentState,
    retainedReferences,
    "policy",
  );
  return { bundle, policy };
}

async function verifyCurrent(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
  retainedReferences: readonly ReferencedPrincipalHead[],
  kind: PrincipalHistoryVerificationKind,
): Promise<
  VerifiedPrincipalPolicyCurrentBundle & {
    readonly history: VerifiedPrincipalPolicyHistory;
  }
> {
  beginPrincipalHistoryVerification();
  // Batches are reusable in the caller's scope; transaction-local hints are
  // published after commit. Autocommit preparation saves each batch. HTTP
  // continuation must move these batches outside the final write transaction;
  // this collector by itself does not bound the duration of a cold request.
  let prepared = await preparePrincipalHistory(executor, {
    head: currentState,
    kind,
    retainedReferences,
    budget: principalHistoryExecutionBudget(),
  });
  while (!prepared.complete) {
    requirePrincipalHistoryContinuation(prepared.request);
    prepared = await preparePrincipalHistory(executor, {
      head: currentState,
      kind,
      retainedReferences,
      budget: principalHistoryExecutionBudget(),
    });
  }
  const authority = currentState.externalAuthority;
  if (
    kind === "policy" &&
    authority &&
    authority.principalId !== currentState.principalId
  ) {
    const currentAuthority = await getCurrentPrincipalState(
      "group",
      authority.principalId,
      executor,
    );
    if (!currentAuthority)
      throw principalHistoryError("authority", "external authority is missing");
    await verifyCurrent(executor, currentAuthority, [authority], "authority");
  }
  const bundle = await buildPrincipalPolicyCurrentForStateWithExecutor(
    executor,
    currentState,
  );
  const verified = await verifyPrincipalPolicyCurrent({
    current: bundle,
    history: prepared.history,
  });
  if (!verified.ok) throw principalHistoryError(kind, verified.error.message);
  return { bundle, policy: verified.value, history: prepared.history };
}

/** Progress and artifacts verified inside a transaction roll back together. */
export async function verifyStoredPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<VerifiedPrincipalPolicyCurrent> {
  return (
    await getVerifiedPrincipalPolicyForStateWithExecutor(executor, currentState)
  ).policy;
}

export async function getPrincipalPolicyForStateWithExecutor(
  executor: DatabaseSession,
  currentState: StoredPrincipalState,
): Promise<PrincipalPolicyBundleResponse> {
  const { history } = await verifyCurrent(executor, currentState, [], "policy");
  const bundle = await buildPrincipalPolicyForStateWithExecutor(
    executor,
    currentState,
  );
  const verified = await verifyPrincipalPolicyBundleAgainstHistory({
    bundle,
    history,
  });
  if (!verified.ok)
    throw principalHistoryError("policy", verified.error.message);
  return bundle;
}
