import {
  KeyingVerificationError,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import type {
  AcknowledgedPrincipalCurrentPublication,
  ReconciledPrincipalCurrentPublication,
} from "../../data/persistence/principalCurrentAcknowledgementPersistence";
import { loadPrincipalHistoryPrefix } from "../../data/persistence/principalHistoryPrefixPersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import { selectRecoveredPrincipalHistory } from "../principals/principalHistoryRecoveryReferences";
import type { RecoverPrincipalPolicyHistoryOptions } from "../principals/principalHistoryRecoveryTypes";
import { principalHistoryVerificationContext } from "../principals/principalHistoryRecoveryVerification";
import { restoreAcknowledgedPrincipalPrefix } from "./acknowledgedPrincipalPredecessor";

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
    return {
      ...publication,
      preservePrefix: false,
      observedPrefixProgress,
      observedCheckpoint: checkpoint,
      retainedPrefix: publication.prefix,
      checkpointPolicy: publication.policy,
    };
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
    return {
      ...publication,
      preservePrefix: false,
      observedPrefixProgress,
      observedCheckpoint: checkpoint,
      retainedPrefix: publication.prefix,
      checkpointPolicy: publication.policy,
    };
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
