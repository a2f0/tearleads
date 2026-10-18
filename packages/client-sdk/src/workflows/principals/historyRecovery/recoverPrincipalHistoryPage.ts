import { KeyingVerificationError } from "@tearleads/crypto";
import { PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE } from "@tearleads/validators/response";
import { loadRecoveredPrincipalHistoryPage } from "./loadRecoveredPrincipalHistoryPage";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import type { RecoverPrincipalPolicyHistoryOptions } from "./principalHistoryRecoveryTypes";
import { recoverPrincipalPolicyHistoryWithVersions } from "./recoverPrincipalPolicyHistory";

/** Disposable page proof loss may replay signed pages once online, preserving durable pins. */
export async function recoverPrincipalHistoryPage(
  options: RecoverPrincipalPolicyHistoryOptions,
  beforeVersion: number,
) {
  try {
    return await loadRecoveredPrincipalHistoryPage(options, beforeVersion);
  } catch (error) {
    if (!(error instanceof PrincipalHistoryEvidenceUnavailableError))
      throw error;
    // A local-first display read must distinguish disposable proof damage
    // from a durable fork or an invalid caller citation, which are not wrapped.
    // Preserve that distinction so the online caller can replay signed pages.
    if (options.offline)
      throw new KeyingVerificationError(
        "missing_dependency",
        "Principal history display proof is unavailable",
      );
  }
  const first = Math.max(
    1,
    beforeVersion - PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE - 1,
  );
  await recoverPrincipalPolicyHistoryWithVersions(
    options,
    Array.from({ length: beforeVersion - first }, (_, index) => first + index),
  );
  try {
    return await loadRecoveredPrincipalHistoryPage(options, beforeVersion);
  } catch (error) {
    throw error instanceof PrincipalHistoryEvidenceUnavailableError
      ? error.verificationError
      : error;
  }
}
