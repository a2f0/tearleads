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
import type { RecoveredPrincipalHistoryPage } from "./loadRecoveredPrincipalHistoryPage";
import {
  PrincipalHistoryRecoveryRaceError,
  PrincipalPolicyHistoryReadError,
} from "./principalHistoryRecoveryTypes";
import { createScopedPrincipalPolicyHistoryBatch } from "./principalRecoveryBatch";
import { recoverWithPrincipalLocalPreference } from "./principalRecoveryLocalPreference";
import { queuePrincipalRecovery } from "./principalRecoveryQueue";
import { recoverCurrentOrganizationPolicy } from "./recoverCurrentOrganizationPolicy";
import {
  type RecoveredScopedPrincipalPolicyHistory,
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

/** Keep the private recovery key inside its runtime lease while resolving cited evidence. */
export function createRuntimePrincipalPolicyResolver(
  runtime: PrincipalPolicyRecoveryRuntime,
  options: { readonly preferLocalCurrent?: boolean } = {},
): ReferencedPrincipalPolicyWarmer["resolveReference"] {
  const resolve = createRuntimePrincipalPolicyCurrentResolver(runtime);
  return resolve
    ? (input) =>
        resolve({ ...input, preferLocalCurrent: options.preferLocalCurrent })
    : undefined;
}

export interface ResolvedPrincipalPolicyCurrent
  extends ResolvedPrincipalPolicyEvidence {
  readonly current: PrincipalPolicyPageCurrent;
  /** Rows end at the selected reference; current/policy may describe a newer recovered head. */
  readonly historyPage?: RecoveredPrincipalHistoryPage | undefined;
}

interface PrincipalPolicyCurrentRequest
  extends Omit<PrincipalPolicyResolveRequest, "reference"> {
  readonly reference?: PrincipalPolicyResolveRequest["reference"] | undefined;
  /** A read-model caller has selected this exact signed head; not a freshness read. */
  readonly preferLocalCurrent?: boolean | undefined;
  readonly historyPage?: { readonly beforeVersion?: number } | undefined;
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
    ReturnType<typeof createScopedPrincipalPolicyHistoryBatch>
  >();
  const recoverFor = (batch: object | undefined) => {
    if (!batch)
      return {
        recover: recoverScopedPrincipalPolicyHistory,
        currentOrganization: recoverCurrentOrganizationPolicy,
      };
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
            assertHistoryPageRequest(input);
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
              const batch = recoverFor(input.recoveryBatch);
              const result: RecoveredScopedPrincipalPolicyHistory =
                input.reference
                  ? await recoverWithPrincipalLocalPreference(
                      batch.recover,
                      {
                        ...options,
                        reference: input.reference,
                        historyPage: input.historyPage,
                      },
                      input.preferLocalCurrent === true,
                    )
                  : await batch.currentOrganization(options);
              return {
                current: result.current,
                organizationId: input.organizationId,
                policy: result.policy,
                dependencies: result.dependencies,
                historyPage: result.historyPage,
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

function assertHistoryPageRequest(input: PrincipalPolicyCurrentRequest) {
  if (!input.historyPage) return;
  const before = input.historyPage.beforeVersion;
  if (
    !input.reference ||
    (before !== undefined &&
      (!Number.isSafeInteger(before) ||
        before <= 1 ||
        before > input.reference.version + 1))
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "History display requires a selected head and an in-range cursor",
    );
}
