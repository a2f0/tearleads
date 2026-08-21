import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";

type PrincipalPolicyStateHead = Pick<
  ReferencedPrincipalHead,
  | "principalType"
  | "principalId"
  | "version"
  | "keyEpoch"
  | "stateHash"
  | "keyFingerprint"
>;

/** Flatten a bundle's previous + current states into one chain for matching. */
export function principalPolicyBundleStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

/**
 * The exact six-field head match every reference check uses. All callers must
 * agree on this definition of "the same state": a check that dropped a field
 * would accept a forged or stale head that the others reject.
 */
export function principalStateMatchesReference(
  state: PrincipalPolicyStateHead,
  reference: ReferencedPrincipalHead,
): boolean {
  return (
    state.principalType === reference.principalType &&
    state.principalId === reference.principalId &&
    state.version === reference.version &&
    state.keyEpoch === reference.keyEpoch &&
    state.stateHash === reference.stateHash &&
    state.keyFingerprint === reference.keyFingerprint
  );
}

export function principalPolicyBundleContainsReference(
  bundle: PrincipalPolicyBundleResponse,
  reference: ReferencedPrincipalHead,
): boolean {
  return principalPolicyBundleStates(bundle).some((state) =>
    principalStateMatchesReference(state, reference),
  );
}
