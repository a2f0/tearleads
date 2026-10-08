import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { AcknowledgedPrincipalCurrentPublication } from "../../data/persistence/principalCurrentAcknowledgementPersistence";
import { preparePrincipalHistoryEvidencePage } from "../../data/persistence/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import { principalHistoryEvidenceScopeId } from "../../data/principals/principalHistoryPrefixProtection";
import { collectPrincipalPolicySignerPublicKeys } from "../principals/policyVerification";
import type { RecoverPrincipalPolicyHistoryOptions } from "../principals/principalHistoryRecoveryTypes";
import {
  assertPrincipalHistoryVerificationMode,
  principalHistoryVerificationContext,
} from "../principals/principalHistoryRecoveryVerification";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import { sealPrincipalCurrentPublication } from "./principalCurrentPublicationSeal";
import { assertPrincipalPolicyReceiptArtifacts } from "./principalPolicyReceiptArtifacts";

/** Verify a newly authored group from genesis before its atomic directory publication. */
export async function prepareInitialGroupCurrentPublication(
  input: RecoverPrincipalPolicyHistoryOptions,
  request: PutPrincipalPolicyRequest,
  response: PrincipalPolicyMutationResponse,
): Promise<AcknowledgedPrincipalCurrentPublication> {
  const current = () => !input.signal?.aborted && input.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const expectedHead = await groupPolicyMutationHead(request);
  if (
    request.state.principalType !== "group" ||
    request.state.version !== 1 ||
    request.state.prevStateHash !== null ||
    !principalHeadMatchesReference(expectedHead, input.expectedHead)
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Initial group publication must begin at its exact genesis",
    );
  assertPrincipalPolicyReceiptArtifacts({ expectedHead, request, response });
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: { currentState: response.currentState, previousStates: [] },
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
  assertProjectionVerificationCurrent(current);
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: expectedHead.principalId,
  });
  const entry = {
    state: response.currentState,
    projection: response.currentProjection,
    grants: response.currentGrants,
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
    current: response,
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
    response,
  );
  assertProjectionVerificationCurrent(current);
  return {
    ...sealed,
    policy: policy.value,
    predecessorStage: null,
    previousPrefixProgress: null,
    evidence: await preparePrincipalHistoryEvidencePage({
      scopeId,
      organizationId: input.organizationId,
      entries: [entry],
      nodes: appended.value.indexNodes,
    }),
  };
}
