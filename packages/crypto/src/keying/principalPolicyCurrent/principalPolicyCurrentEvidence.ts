import type { PrincipalStateExternalAuthority } from "../../principalState/principalState";
import { throwVerification } from "../core/shared";
import {
  makeVerifiedPrincipalPolicyCurrent,
  type VerifiedPrincipalPolicyCurrent,
} from "../principalPolicy/principalPolicyTypes";

type CurrentValue = Parameters<typeof makeVerifiedPrincipalPolicyCurrent>[0];
const issued = new WeakMap<
  VerifiedPrincipalPolicyCurrent,
  {
    policy: CurrentValue;
    latestAuthority: PrincipalStateExternalAuthority | null;
  }
>();

/** Keep the verified predecessor and historical authority cursor private. */
export function issueVerifiedPrincipalPolicyCurrent(
  value: CurrentValue,
  latestAuthority: PrincipalStateExternalAuthority | null,
): VerifiedPrincipalPolicyCurrent {
  const result = makeVerifiedPrincipalPolicyCurrent(value);
  issued.set(result, structuredClone({ policy: value, latestAuthority }));
  return result;
}

export function ownVerifiedPrincipalPolicyCurrent(
  policy: VerifiedPrincipalPolicyCurrent,
) {
  const snapshot = issued.get(policy);
  if (!snapshot)
    throwVerification(
      "invalid_shape",
      "current policy must come from a local verifier",
    );
  return structuredClone(snapshot);
}
