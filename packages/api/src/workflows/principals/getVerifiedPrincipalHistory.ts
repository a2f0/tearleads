import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import type { PrincipalPolicyArtifactRead } from "../../access/read/principalPolicyArtifacts";
import { beginPrincipalHistoryVerification } from "../../utils/principalHistoryWork";
import { preparePrincipalHistory } from "./preparePrincipalHistory";
import {
  principalHistoryExecutionBudget,
  requirePrincipalHistoryContinuation,
} from "./principalHistoryExecution";

/** Reuse a verified prefix or yield to preparation outside the transaction. */
export async function getVerifiedPrincipalHistory(
  executor: DatabaseSession,
  head: ReferencedPrincipalHead,
  retainedReferences: readonly ReferencedPrincipalHead[],
  kind: PrincipalHistoryVerificationKind = "policy",
  artifactRead?: PrincipalPolicyArtifactRead,
): Promise<VerifiedPrincipalPolicyHistory> {
  beginPrincipalHistoryVerification();
  let prepared = await preparePrincipalHistory(executor, {
    head,
    kind,
    retainedReferences,
    budget: principalHistoryExecutionBudget(head),
    ...(artifactRead ? { artifactRead } : {}),
  });
  while (!prepared.complete) {
    requirePrincipalHistoryContinuation(prepared.request);
    prepared = await preparePrincipalHistory(executor, {
      head,
      kind,
      retainedReferences,
      budget: principalHistoryExecutionBudget(head),
      ...(artifactRead ? { artifactRead } : {}),
    });
  }
  return prepared.history;
}
