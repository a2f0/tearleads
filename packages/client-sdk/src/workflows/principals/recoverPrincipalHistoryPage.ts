import {
  loadRecoveredPrincipalHistoryPage,
  PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
} from "./loadRecoveredPrincipalHistoryPage";
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
    if (options.offline) throw error.verificationError;
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
