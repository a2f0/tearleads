import type {
  PrincipalProjectionMember,
  PrincipalStateExternalAuthority,
} from "../principalState";

export interface PrincipalPolicyExternalAuthorityState {
  readonly head: PrincipalStateExternalAuthority;
  readonly projection: readonly PrincipalProjectionMember[];
}

/**
 * Verified state history for the external policy that can authorize this
 * principal. `currentHead` rejects successors that cite stale authority after
 * the caller's local principal-policy checkpoint.
 */
export interface PrincipalPolicyExternalAuthority {
  readonly currentHead: PrincipalStateExternalAuthority;
  readonly states: readonly PrincipalPolicyExternalAuthorityState[];
}
