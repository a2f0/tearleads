import {
  KeyingVerificationError,
  restorePrincipalPolicyHistoryVerifier,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  loadPrincipalHistoryPrefix,
  type PrincipalHistoryPrefix,
} from "../../data/persistence/principalHistoryPrefixPersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import {
  principalHistoryEvidenceScopeId,
  principalHistoryPrefixProtection,
} from "../../data/principals/principalHistoryPrefixProtection";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import { parsePrincipalHistoryStageCurrent } from "../../data/principals/principalHistoryStageProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { RecoverPrincipalPolicyHistoryOptions } from "../principals/principalHistoryRecoveryTypes";
import { principalHistoryVerificationContext } from "../principals/principalHistoryRecoveryVerification";

/** Sealed predecessor evidence, owned by a mutation before its request is sent. */
export type AcknowledgedPrincipalPredecessor = Readonly<PrincipalHistoryPrefix>;

/** Authenticate the entire prefix, including its scope and current artifacts. */
export async function restoreAcknowledgedPrincipalPrefix(
  options: RecoverPrincipalPolicyHistoryOptions,
  saved: AcknowledgedPrincipalPredecessor | null,
) {
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: options.organizationId,
    head: options.expectedHead,
    protection: options.protection,
  });
  if (
    !saved ||
    saved.scopeId !== scopeId ||
    saved.organizationId !== options.organizationId
  )
    throw new KeyingVerificationError(
      "missing_dependency",
      "Acknowledgement requires its authenticated predecessor prefix",
    );
  const restored = await restorePrincipalPolicyHistoryVerifier(
    {
      principalId: options.expectedHead.principalId,
      principalType: options.expectedHead.principalType,
    },
    saved.progress,
    await principalHistoryPrefixProtection(options.protection, saved),
  );
  if (!restored.ok) throw restored.error;
  const artifacts = parsePrincipalHistoryStageCurrent({
    currentJson: saved.currentJson,
    afterVersion: saved.version - 1,
  });
  if (!artifacts)
    throw new KeyingVerificationError(
      "invalid_shape",
      "Acknowledged predecessor artifacts are malformed",
    );
  const history = restored.value.finish(
    principalPolicyReferenceFromBundle(artifacts),
  );
  if (!history.ok) throw history.error;
  const previous = await verifyPrincipalPolicyCurrent({
    current: artifacts,
    history: history.value,
  });
  if (!previous.ok) throw previous.error;
  return {
    scopeId,
    saved,
    artifacts,
    verifier: restored.value,
    previous: previous.value,
    history: history.value,
    predecessorIndexRootHash: history.value.indexRootHash,
  };
}

/** Capture exact predecessor evidence while authoring, before HTTP can commit. */
export async function captureAcknowledgedPrincipalPredecessor(
  input: RecoverPrincipalPolicyHistoryOptions,
): Promise<AcknowledgedPrincipalPredecessor> {
  const protection = ownPrincipalHistoryProtection(input.protection);
  const options = {
    ...input,
    expectedHead: structuredClone(input.expectedHead),
    protection: {
      ...protection,
      context: principalHistoryVerificationContext(input),
    },
  };
  const current = () => !options.signal?.aborted && options.stillCurrent();
  try {
    assertProjectionVerificationCurrent(current);
    const scopeId = await principalHistoryEvidenceScopeId({
      organizationId: options.organizationId,
      head: options.expectedHead,
      protection: options.protection,
    });
    const restored = await restoreAcknowledgedPrincipalPrefix(
      options,
      await loadPrincipalHistoryPrefix(options.execSql, scopeId),
    );
    assertProjectionVerificationCurrent(current);
    if (
      !principalHeadMatchesReference(
        restored.previous.state,
        options.expectedHead,
      )
    )
      throw new Error(
        "Principal policy changed before submission; retry the mutation",
      );
    return structuredClone(restored.saved);
  } finally {
    protection.localKey.fill(0);
  }
}

export async function restoreAcknowledgedPrincipalPredecessor(
  options: RecoverPrincipalPolicyHistoryOptions,
  saved: AcknowledgedPrincipalPredecessor | null,
) {
  const restored = await restoreAcknowledgedPrincipalPrefix(options, saved);
  if (
    !principalHeadMatchesReference(
      restored.previous.state,
      options.expectedHead,
    )
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Acknowledgement predecessor does not match the authored request",
    );
  return restored;
}
