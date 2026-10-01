import type { PrincipalContainerGrant } from "@tearleads/crypto";
import { PrincipalPolicyError } from "./shared";

/**
 * Container KEK wraps sealed to a group's key stay stored after the group
 * loses a grant, so a member added later at the same key epoch could still
 * open them. A policy that removes a container grant must therefore rotate the
 * group key (#2365 finding 20); honest clients rotate on every access-set
 * shrink and change an access level only in place.
 */
export function assertGrantRemovalRotatesKey(input: {
  readonly nextGrants: readonly PrincipalContainerGrant[];
  readonly nextKeyEpoch: number;
  readonly previousGrants: readonly PrincipalContainerGrant[];
  readonly previousKeyEpoch: number | null;
}): void {
  if (
    input.previousKeyEpoch === null ||
    input.nextKeyEpoch > input.previousKeyEpoch
  ) {
    return;
  }
  const retained = new Set(input.nextGrants.map((grant) => grant.containerId));
  if (input.previousGrants.some((grant) => !retained.has(grant.containerId))) {
    throw new PrincipalPolicyError(
      "A group policy that removes a container grant must rotate the group key",
      409,
    );
  }
}
