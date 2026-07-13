import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import type {
  ReferencedPrincipalPolicyWarmer,
  ReferencedPrincipalPolicyWarmRequest,
} from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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
    getEncapsulationKey?:
      | ((userId: string) => Promise<EncapsulationKeyResponse | null>)
      | undefined;
  };
  readonly infra: { readonly execSql: ExecSql };
  readonly util: {
    readonly cacheReferencedPrincipalPolicies: (
      references: ReferencedPrincipalPolicyWarmRequest["references"],
    ) => Promise<void>;
    readonly log: (message: string) => void;
  };
}

export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
): ReferencedPrincipalPolicyWarmer {
  const getCurrentPrincipalPolicy = runtime.apiClient.getCurrentPrincipalPolicy;
  const getEncapsulationKey = runtime.apiClient.getEncapsulationKey;
  return async ({ organizationId, references }) => {
    if (organizationId === runtime.auth.organizationId) {
      await runtime.util.cacheReferencedPrincipalPolicies(references);
      return;
    }
    if (!getCurrentPrincipalPolicy || !getEncapsulationKey) {
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
      getEncapsulationKey: (userId) =>
        getEncapsulationKey.call(runtime.apiClient, userId),
      log: runtime.util.log,
      organizationId,
      references,
    });
  };
}
