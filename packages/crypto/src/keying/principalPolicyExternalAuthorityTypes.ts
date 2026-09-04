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
 * principal. `currentHead` selects the authority for new mutations. Historical
 * verification only checks that it belongs to `states`; each entry authorizes
 * its signer at its exact citation, which may predate this head.
 */
export interface PrincipalPolicyExternalAuthority {
  readonly currentHead: PrincipalStateExternalAuthority;
  readonly states: readonly PrincipalPolicyExternalAuthorityState[];
}
