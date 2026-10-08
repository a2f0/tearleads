import {
  createPrincipalPolicyHistoryVerifier,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { principalPolicyHead } from "./principalPolicyFixtures";

/** Exercise request builders with genuine current evidence and no full bundle. */
export async function currentGroupMutationInput(
  bundle: PrincipalPolicyBundleResponse,
  signerPublicKeys: readonly PrincipalPolicySignerPublicKey[],
  retainedReferences: readonly ReferencedPrincipalHead[] = [],
) {
  const verifier = createPrincipalPolicyHistoryVerifier({
    retainedReferences,
    principalType: bundle.currentState.principalType,
    principalId: bundle.currentState.principalId,
  });
  const appended = await verifier.append({
    entries: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    signerPublicKeys,
  });
  if (!appended.ok) throw appended.error;
  const history = verifier.finish(principalPolicyHead(bundle));
  if (!history.ok) throw history.error;
  const { previousStates: _previousStates, ...currentPolicy } = bundle;
  const checked = await verifyPrincipalPolicyCurrent({
    current: currentPolicy,
    history: history.value,
  });
  if (!checked.ok) throw checked.error;
  return {
    currentPolicy,
    verifiedCurrentPolicy: checked.value,
    localPolicyCheckpoint: checked.value.checkpoint,
    stillCurrent: () => true,
  };
}
