import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { PrincipalPolicyHistoryReadError } from "./principalHistoryRecoveryTypes";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

/** Refusals and invalid evidence must never silently select a cached policy. */
export function isPrincipalRecoveryOutage(error: unknown): boolean {
  if (!(error instanceof PrincipalPolicyHistoryReadError)) return false;
  const { failure } = error;
  return (
    failure.kind === "network" ||
    (failure.kind === "http" &&
      failure.status !== null &&
      failure.status >= 500) ||
    (failure.kind === "cancelled" &&
      failure.code === "principal_history_request_timed_out")
  );
}

export async function recoverWithPrincipalOutageFallback(
  recover: typeof recoverScopedPrincipalPolicyHistory,
  options: Parameters<typeof recoverScopedPrincipalPolicyHistory>[0],
) {
  try {
    return await recover(options);
  } catch (error) {
    assertProjectionVerificationCurrent(options.stillCurrent);
    if (options.offline || !isPrincipalRecoveryOutage(error)) throw error;
    try {
      return await recoverScopedPrincipalPolicyHistory({
        ...options,
        offline: true,
      });
    } catch (localError) {
      if (
        localError instanceof KeyingVerificationError &&
        localError.code === "missing_dependency"
      )
        throw new ProjectionDependencyUnavailableError(localError.message);
      throw localError;
    }
  }
}
