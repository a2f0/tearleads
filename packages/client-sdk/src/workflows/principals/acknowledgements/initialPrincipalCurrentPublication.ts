import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import type { AcknowledgedPrincipalCurrentPublication } from "../../../data/persistence/principalCurrentAcknowledgementPersistence";
import { preparePrincipalHistoryEvidencePage } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import { principalHistoryEvidenceScopeId } from "../../../data/principals/principalHistoryPrefixProtection";
import type { RecoverPrincipalPolicyHistoryOptions } from "../historyRecovery/principalHistoryRecoveryTypes";
import {
  assertPrincipalHistoryVerificationMode,
  principalHistoryVerificationContext,
} from "../historyRecovery/principalHistoryRecoveryVerification";
import { collectPrincipalPolicySignerPublicKeys } from "../policyVerification";
import type { AcknowledgedPrincipalPredecessor } from "./acknowledgedPrincipalPredecessor";
import type { PrincipalAcknowledgementChecks } from "./principalAcknowledgementChecks";
import { sealPrincipalCurrentPublication } from "./principalCurrentPublicationSeal";

/** Verify a newly authored group from genesis before its atomic directory publication. */
export async function prepareInitialGroupCurrentPublication(
  input: RecoverPrincipalPolicyHistoryOptions,
  request: PutPrincipalPolicyRequest,
  current: PrincipalPolicyPageCurrent,
  predecessor: AcknowledgedPrincipalPredecessor | null,
  checks: PrincipalAcknowledgementChecks,
): Promise<AcknowledgedPrincipalCurrentPublication> {
  const stillCurrent = () => !input.signal?.aborted && input.stillCurrent();
  assertProjectionVerificationCurrent(stillCurrent);
  const expectedHead = await checks.authoredHead(request);
  if (
    predecessor !== null ||
    request.state.principalType !== "group" ||
    request.state.version !== 1 ||
    request.state.prevStateHash !== null ||
    !principalHeadMatchesReference(expectedHead, input.expectedHead)
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Initial group publication must begin at its exact genesis",
    );
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: { currentState: current.currentState, previousStates: [] },
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in keys)
    throw new KeyingVerificationError(
      "signer_mismatch",
      "Initial group signer could not be authenticated",
    );
  const externalAuthority = await input.loadExternalAuthority?.(
    request.state.externalAuthority ? [request.state.externalAuthority] : [],
  );
  assertProjectionVerificationCurrent(stillCurrent);
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: expectedHead.principalId,
  });
  const entry = {
    state: current.currentState,
    projection: current.currentProjection,
    grants: current.currentGrants,
  };
  assertPrincipalHistoryVerificationMode(input, [entry]);
  const appended = await verifier.append({
    entries: [entry],
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (!appended.ok) throw appended.error;
  const history = verifier.finish(expectedHead);
  if (!history.ok) throw history.error;
  const policy = await verifyPrincipalPolicyCurrent({
    current,
    history: history.value,
  });
  if (!policy.ok) throw policy.error;
  const options = {
    ...input,
    protection: {
      ...input.protection,
      context: principalHistoryVerificationContext(input),
    },
  };
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: input.organizationId,
    head: expectedHead,
    protection: options.protection,
  });
  const sealed = await sealPrincipalCurrentPublication(
    options,
    scopeId,
    expectedHead,
    verifier,
    current,
  );
  assertProjectionVerificationCurrent(stillCurrent);
  return {
    ...sealed,
    policy: policy.value,
    predecessorStage: null,
    predecessorIndexRootHash: null,
    previousPrefixProgress: null,
    evidence: await preparePrincipalHistoryEvidencePage({
      indexRootHash: appended.value.indexRootHash,
      scopeId,
      organizationId: input.organizationId,
      entries: [entry],
      nodes: appended.value.indexNodes,
    }),
  };
}
