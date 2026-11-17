import type { UserIdentityResponse } from "@tearleads/validators/response";
import type { CurrentPrincipalPolicyReader } from "../../src/workflows/principals/currentPrincipalPolicyReader";
import {
  type CacheReferencedPrincipalPoliciesOptions,
  cacheReferencedPrincipalPolicies,
} from "../../src/workflows/principals/policyCache";
import type { PolicyDirectoryFixture } from "./policyDirectoryFixtures";
import { createMockApiTrustedUserIdentityResolver } from "./trustedUserIdentity";

type CacheReferencedPoliciesOptions = Omit<
  CacheReferencedPrincipalPoliciesOptions,
  | "currentPolicyReader"
  | "reportSecurityIncident"
  | "resolveTrustedUserIdentity"
> & {
  readonly directory?: PolicyDirectoryFixture;
  readonly getCurrentPrincipalPolicy: CurrentPrincipalPolicyReader["getCurrentPrincipalPolicy"];
  readonly getUserIdentity: (
    userId: string,
  ) => Promise<UserIdentityResponse | null>;
  readonly reportSecurityIncident?:
    | CacheReferencedPrincipalPoliciesOptions["reportSecurityIncident"]
    | undefined;
};

export function cacheReferencedPolicies(
  options: CacheReferencedPoliciesOptions,
): Promise<void> {
  const {
    directory,
    getCurrentPrincipalPolicy,
    getUserIdentity,
    reportSecurityIncident,
    ...cacheOptions
  } = options;
  return cacheReferencedPrincipalPolicies({
    ...cacheOptions,
    currentPolicyReader: {
      getCurrentPrincipalPolicy: (kind, id) =>
        directory &&
        kind === "organization" &&
        id === directory.bundle.currentState.principalId
          ? Promise.resolve(directory.bundle)
          : getCurrentPrincipalPolicy(kind, id),
    },
    reportSecurityIncident: reportSecurityIncident ?? (async () => undefined),
    resolveTrustedUserIdentity: createMockApiTrustedUserIdentityResolver(
      (userId) =>
        directory && userId === directory.signer.userId
          ? Promise.resolve(directory.signer)
          : getUserIdentity(userId),
    ),
  });
}
