import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { readContainerState } from "../../../data/containers/shared/projection";
import type { PrincipalPolicyCache } from "../../../data/keyingProjectionVerification";
import {
  dedupeReferencedPrincipalStates,
  referencedPrincipalPolicyKey,
} from "../../../data/keyingProjectionVerification/principalPolicyCache";
import type { CurrentPolicyReferenceResolver } from "../../../data/principals/currentPolicyReferenceResolver";
import type { PrincipalPolicyCurrentEvidence } from "../../../data/principals/principalPolicyEvidence";

/** Current membership with only the historical group citations this path uses. */
export async function selectReplacementPrincipalPolicyReferences(input: {
  readonly policy: PrincipalPolicyCurrentEvidence;
  readonly projection: ContainerWriterProjectionResponse;
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly resolveAuthoredPolicyReferences?:
    | CurrentPolicyReferenceResolver
    | undefined;
}): Promise<PrincipalPolicyCurrentEvidence> {
  if (
    !("retainedHistory" in input.policy) ||
    !input.resolveAuthoredPolicyReferences
  )
    return input.policy;
  const references = dedupeReferencedPrincipalStates(
    input.projection.path
      .flatMap(
        (manifest) => readContainerState(manifest).referencedPrincipalHeads,
      )
      .filter(
        (reference) =>
          reference.principalType === input.policy.principalType &&
          reference.principalId === input.policy.principalId,
      ),
  );
  const selected = await input.resolveAuthoredPolicyReferences(
    input.policy,
    references,
  );
  // Only speculative successor citations use this cache entry. Served historical
  // references still resolve to acknowledged policies and cannot pin our new head.
  input.principalPolicyCache?.set(
    referencedPrincipalPolicyKey(selected.state),
    selected,
  );
  return selected;
}
