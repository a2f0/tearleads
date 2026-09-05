import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type {
  PrincipalPolicyBundleCacheRequest,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  cachePrincipalPolicyBundles,
  cacheReferencedPrincipalPolicies,
} from "./policyCache";

interface PrincipalPolicyWarmRuntime {
  readonly apiClient: {
    getCurrentPrincipalPolicy(
      principalType: "group" | "organization",
      principalId: string,
    ): Promise<PrincipalPolicyBundleResponse | null>;
  };
  readonly infra: { readonly execSql: ExecSql };
  readonly util: {
    readonly log: (message: string) => void;
    readonly reportSecurityIncident: SecurityIncidentReporter;
  };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
): ReferencedPrincipalPolicyWarmer {
  const policyInput = ({
    organizationId,
    references,
    stillCurrent,
  }: Parameters<ReferencedPrincipalPolicyWarmer>[0]) => {
    const input: Parameters<typeof cacheReferencedPrincipalPolicies>[0] = {
      execSql: runtime.infra.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        runtime.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
      log: runtime.util.log,
      organizationId,
      reportSecurityIncident: runtime.util.reportSecurityIncident,
      references,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      stillCurrent,
    };
    return input;
  };
  const warmer = async (
    input: Parameters<ReferencedPrincipalPolicyWarmer>[0],
  ) => cacheReferencedPrincipalPolicies(policyInput(input));
  const cacheBundles = (input: PrincipalPolicyBundleCacheRequest) =>
    cachePrincipalPolicyBundles({
      bundles: input.bundles,
      execSql: runtime.infra.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        runtime.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
      log: runtime.util.log,
      organizationId: input.organizationId,
      reportSecurityIncident: runtime.util.reportSecurityIncident,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      stillCurrent: input.stillCurrent,
    });
  return Object.assign(warmer, { cacheBundles });
}
