import type {
  ApiClient,
  PrincipalPolicyPageCurrent,
} from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyResolveRequest,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "../../data/keyingProjectionVerification/types";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { readPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  PrincipalHistoryRecoveryRaceError,
  PrincipalPolicyHistoryReadError,
} from "./principalHistoryRecoveryTypes";
import { recoverWithPrincipalOutageFallback } from "./principalRecoveryOutage";
import { queuePrincipalRecovery } from "./principalRecoveryQueue";
import { recoverCurrentOrganizationPolicy } from "./recoverCurrentOrganizationPolicy";
import {
  createScopedPrincipalPolicyHistoryBatch,
  recoverScopedPrincipalPolicyHistory,
} from "./recoverScopedPrincipalPolicyHistory";

export interface PrincipalPolicyRecoveryRuntime {
  readonly apiClient: Partial<
    Pick<
      ApiClient,
      "getPrincipalPolicyPages" | "getProjectionPolicyHistoryPages"
    >
  >;
  readonly infra: { readonly execSql: ExecSql };
  readonly state?: { readonly online: boolean } | undefined;
  readonly util: { readonly reportSecurityIncident: SecurityIncidentReporter };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
}

export function createRuntimePrincipalPolicyResolver(
  runtime: PrincipalPolicyRecoveryRuntime,
): ReferencedPrincipalPolicyWarmer["resolveReference"] {
  return createRuntimePrincipalPolicyCurrentResolver(runtime);
}

export interface ResolvedPrincipalPolicyCurrent
  extends ResolvedPrincipalPolicyEvidence {
  readonly current: PrincipalPolicyPageCurrent;
}

interface PrincipalPolicyCurrentRequest
  extends Omit<PrincipalPolicyResolveRequest, "reference"> {
  readonly reference?: PrincipalPolicyResolveRequest["reference"] | undefined;
}

/** Keep current artifacts with their verified evidence and private runtime lifetime. */
export function createRuntimePrincipalPolicyCurrentResolver(
  runtime: PrincipalPolicyRecoveryRuntime,
):
  | ((
      input: PrincipalPolicyCurrentRequest,
    ) => Promise<ResolvedPrincipalPolicyCurrent>)
  | undefined {
  const lease = readPrincipalHistoryProtection(runtime);
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
          objectId: input.reference?.principalId ?? input.organizationId,
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
              const options = {
                apiClient: { getPrincipalPolicyPages: readPages },
                execSql: runtime.infra.execSql,
                offline,
                organizationId: input.organizationId,
                protection,
                resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
                stillCurrent,
              };
              const result = input.reference
                ? await recoverWithPrincipalOutageFallback(
                    recoverFor(input.recoveryBatch),
                    { ...options, reference: input.reference },
                  )
                : await recoverCurrentOrganizationPolicy(options);
              return {
                current: result.current,
                organizationId: input.organizationId,
                policy: result.policy,
                dependencies: result.dependencies,
                stillCurrent,
              };
            } catch (error) {
              assertProjectionVerificationCurrent(stillCurrent);
              if (
                error instanceof PrincipalPolicyHistoryReadError ||
                error instanceof PrincipalHistoryRecoveryRaceError ||
                (error instanceof KeyingVerificationError &&
                  error.code === "missing_dependency")
              )
                throw new ProjectionDependencyUnavailableError(error.message);
              throw error;
            }
          }),
      ),
    );
}
