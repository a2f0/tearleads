import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type {
  ReferencedPrincipalPolicyWarmer,
  ReferencedPrincipalPolicyWarmRequest,
} from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { cacheReferencedPrincipalPolicies } from "./policyCache";

interface PrincipalPolicyWarmRuntime {
  readonly auth: { readonly organizationId: string | null };
  readonly apiClient: {
    getCurrentPrincipalPolicy?:
      | ((
          principalType: "group" | "organization",
          principalId: string,
        ) => Promise<PrincipalPolicyBundleResponse | null>)
      | undefined;
  };
  readonly infra: { readonly execSql: ExecSql };
  readonly util: {
    readonly cacheReferencedPrincipalPolicies: (
      references: ReferencedPrincipalPolicyWarmRequest["references"],
    ) => Promise<void>;
    readonly log: (message: string) => void;
  };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
): ReferencedPrincipalPolicyWarmer {
  const getCurrentPrincipalPolicy = runtime.apiClient.getCurrentPrincipalPolicy;
  return async ({ organizationId, references }) => {
    if (organizationId === runtime.auth.organizationId) {
      await runtime.util.cacheReferencedPrincipalPolicies(references);
      return;
    }
    if (!getCurrentPrincipalPolicy) {
      return;
    }

    await cacheReferencedPrincipalPolicies({
      execSql: runtime.infra.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        getCurrentPrincipalPolicy.call(
          runtime.apiClient,
          principalType,
          principalId,
        ),
      log: runtime.util.log,
      organizationId,
      references,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    });
  };
}
