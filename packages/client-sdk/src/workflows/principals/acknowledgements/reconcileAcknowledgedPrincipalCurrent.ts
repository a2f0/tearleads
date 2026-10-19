import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import type {
  AcknowledgedPrincipalCurrentPublication,
  ReconciledPrincipalCurrentPublication,
} from "../../../data/persistence/principalCurrentAcknowledgementPersistence";
import { loadPrincipalHistoryPrefix } from "../../../data/persistence/principalHistory/principalHistoryPrefixPersistence";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import {
  PrincipalHistoryEvidenceUnavailableError,
  selectRecoveredPrincipalHistory,
} from "../historyRecovery/principalHistoryRecoveryReferences";
import type { RecoverPrincipalPolicyHistoryOptions } from "../historyRecovery/principalHistoryRecoveryTypes";
import { principalHistoryVerificationContext } from "../historyRecovery/principalHistoryRecoveryVerification";
import { restoreAcknowledgedPrincipalPrefix } from "./acknowledgedPrincipalPredecessor";

/** Only the receipt is proven; a newer local pin needs scoped history covering it. */
function reconcileReceiptOnly(
  publication: AcknowledgedPrincipalCurrentPublication,
  observedPrefixProgress: string | null,
  checkpoint: PrincipalPolicyCheckpoint | null,
): ReconciledPrincipalCurrentPublication {
  // Other verified evidence, such as a document purge proof, can pin a newer
  // head without advancing this scope's prefix. That is honest progress this
  // receipt cannot prove membership in: retry after recovery, not a rollback.
  // A genesis receipt has no predecessor, so any existing pin stays a conflict.
  if (
    publication.predecessorStage &&
    checkpoint &&
    checkpoint.version > publication.policy.version
  )
    throw new PrincipalHistoryEvidenceUnavailableError(
      new KeyingVerificationError(
        "missing_dependency",
        "A newer local principal pin is not covered by scoped history",
      ),
    );
  return {
    ...publication,
    preservePrefix: false,
    observedPrefixProgress,
    observedCheckpoint: checkpoint,
    retainedPrefix: publication.prefix,
    checkpointPolicy: publication.policy,
  };
}

/** Prove an already observed successor contains this receipt before preserving it. */
export async function reconcileAcknowledgedPrincipalCurrent(
  input: RecoverPrincipalPolicyHistoryOptions,
  publication: AcknowledgedPrincipalCurrentPublication,
): Promise<ReconciledPrincipalCurrentPublication> {
  const options = {
    ...input,
    protection: {
      ...input.protection,
      context: principalHistoryVerificationContext(input),
    },
  };
  const checkpoint = await loadPrincipalPolicyCheckpoint(
    options.execSql,
    publication.policy.principalType,
    publication.policy.principalId,
  );
  const saved = await loadPrincipalHistoryPrefix(
    options.execSql,
    publication.prefix.scopeId,
  );
  const observedPrefixProgress = saved?.progress ?? null;
  if (observedPrefixProgress === publication.previousPrefixProgress)
    return reconcileReceiptOnly(
      publication,
      observedPrefixProgress,
      checkpoint,
    );
  const restored = await restoreAcknowledgedPrincipalPrefix(options, saved);
  if (restored.previous.version < publication.policy.version) {
    if (
      !principalHeadMatchesReference(
        restored.previous.state,
        options.expectedHead,
      )
    )
      throw new KeyingVerificationError(
        "stale_predecessor",
        "Acknowledgement does not extend the authenticated current prefix",
      );
    return reconcileReceiptOnly(
      publication,
      observedPrefixProgress,
      checkpoint,
    );
  }
  const history = await selectRecoveredPrincipalHistory({
    options: { ...options, retainedReferences: [publication.policy.state] },
    scopeId: publication.prefix.scopeId,
    history: restored.history,
    checkpoint,
  });
  const policy = await verifyPrincipalPolicyCurrent({
    current: restored.artifacts,
    history,
  });
  if (!policy.ok) throw policy.error;
  return {
    ...publication,
    preservePrefix: true,
    observedPrefixProgress,
    observedCheckpoint: checkpoint,
    retainedPrefix: restored.saved,
    checkpointPolicy: policy.value,
  };
}
