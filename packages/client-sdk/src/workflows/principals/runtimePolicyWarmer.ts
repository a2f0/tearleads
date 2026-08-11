import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { cacheReferencedPrincipalPolicies } from "./policyCache";

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
    readonly reportSecurityIncident?: SecurityIncidentReporter | undefined;
  };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
): ReferencedPrincipalPolicyWarmer {
  return async ({ organizationId, references }) => {
    await cacheReferencedPrincipalPolicies({
      execSql: runtime.infra.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        runtime.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
      log: runtime.util.log,
      organizationId,
      reportSecurityIncident: runtime.util.reportSecurityIncident,
      references,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    });
  };
}
