import type { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { PrincipalPolicyHistoryReadError } from "./principalHistoryRecoveryTypes";
import { queuePrincipalRecovery } from "./principalRecoveryQueue";
import {
  createScopedPrincipalPolicyHistoryBatch,
  recoverScopedPrincipalPolicyHistory,
} from "./recoverScopedPrincipalPolicyHistory";

export interface PrincipalPolicyRecoveryRuntime {
  readonly apiClient: Partial<Pick<ApiClient, "getPrincipalPolicyPages">>;
  readonly infra: { readonly execSql: ExecSql };
  readonly state?: { readonly online: boolean } | undefined;
  readonly util: { readonly reportSecurityIncident: SecurityIncidentReporter };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
}

/** Keep the private recovery key inside its runtime lease throughout verification. */
export function createRuntimePrincipalPolicyResolver(
  runtime: PrincipalPolicyRecoveryRuntime,
): ReferencedPrincipalPolicyWarmer["resolveReference"] {
  const lease = runtime.withPrincipalHistoryProtection;
  const readPages = runtime.apiClient.getPrincipalPolicyPages?.bind(
    runtime.apiClient,
  );
  if (!lease || !readPages) return undefined;
  const batches = new WeakMap<
    object,
    typeof recoverScopedPrincipalPolicyHistory
  >();
  const recoverFor = (batch: object | undefined) => {
    if (!batch) return recoverScopedPrincipalPolicyHistory;
    let recover = batches.get(batch);
    if (!recover) {
      recover = createScopedPrincipalPolicyHistoryBatch();
      batches.set(batch, recover);
    }
    return recover;
  };
  return (input) =>
    queuePrincipalRecovery(runtime.infra.execSql, input.organizationId, () =>
      runWithSecurityIncidentReporting(
        runtime.util.reportSecurityIncident,
        {
          objectId: input.reference.principalId,
          objectKind: "principal",
          operation: "principal.policy.recover",
          organizationId: input.organizationId,
        },
        () =>
          lease(async ({ protection, stillCurrent: leaseCurrent }) => {
            const stillCurrent = () =>
              leaseCurrent() && input.stillCurrent?.() !== false;
            assertProjectionVerificationCurrent(stillCurrent);
            const offline = runtime.state?.online === false;
            try {
              const result = await recoverFor(input.recoveryBatch)({
                apiClient: { getPrincipalPolicyPages: readPages },
                execSql: runtime.infra.execSql,
                offline,
                organizationId: input.organizationId,
                protection,
                reference: input.reference,
                resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
                stillCurrent,
              });
              return {
                organizationId: input.organizationId,
                policy: result.policy,
                dependencies: result.dependencies,
                stillCurrent,
              };
            } catch (error) {
              assertProjectionVerificationCurrent(stillCurrent);
              if (
                error instanceof PrincipalPolicyHistoryReadError ||
                (offline &&
                  error instanceof KeyingVerificationError &&
                  error.code === "missing_dependency")
              )
                throw new ProjectionDependencyUnavailableError(error.message);
              throw error;
            }
          }),
      ),
    );
}
