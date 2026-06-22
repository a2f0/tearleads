import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import {
  type CacheReferencedPrincipalPoliciesOptions,
  cacheReferencedPrincipalPolicies,
} from "./policyCache";

// Build a warmer that fetches, verifies, and persists referenced principal
// policies on demand. Threaded into projection verification so a member can
// create under another org's shared container without first hydrating that
// org's group policy. `organizationId` must be the parent container's org so
// external-admin signer verification resolves against the owning org.
export function createReferencedPrincipalPolicyWarmer(
  options: Omit<CacheReferencedPrincipalPoliciesOptions, "references">,
): (
  references: ReadonlyArray<ReferencedPrincipalStateResponse>,
) => Promise<void> {
  return (references) =>
    cacheReferencedPrincipalPolicies({ ...options, references });
}
