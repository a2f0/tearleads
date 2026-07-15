import type {
  ContainerCreateApi,
  ContainerMutationSubmitFailure,
} from "../../../data/containers/shared/types";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import { cachePrincipalPolicyBundles } from "../../principals/policyCache";

export async function cacheRemoteContainerCreatePolicyRepair(input: {
  readonly apiClient: ContainerCreateApi;
  readonly execSql: ExecSql | undefined;
  readonly failure: ContainerMutationSubmitFailure;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<boolean> {
  const bundles = input.failure.stalePrincipalPolicies;
  const getCurrentPrincipalPolicy = input.apiClient.getCurrentPrincipalPolicy;
  if (
    !input.execSql ||
    !bundles ||
    bundles.length === 0 ||
    !getCurrentPrincipalPolicy
  ) {
    return false;
  }

  // The server supplied fresh signed policy bundles with the 409. Verify and
  // cache them locally before rebuilding the signed create request.
  await cachePrincipalPolicyBundles({
    bundles,
    execSql: input.execSql,
    getCurrentPrincipalPolicy,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  return true;
}
