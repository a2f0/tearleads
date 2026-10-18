import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
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
import { getOrCreatePrincipalPolicyCoordinator } from "../../data/principals/principalPolicyCoordinator";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import type { RecoveredPrincipalHistoryPage } from "./historyRecovery/loadRecoveredPrincipalHistoryPage";
import {
  PrincipalHistoryRecoveryRaceError,
  PrincipalPolicyHistoryReadError,
} from "./historyRecovery/principalHistoryRecoveryTypes";
import type { ScopedPrincipalPolicyRecovery } from "./historyRecovery/recoverScopedPrincipalPolicyHistory";
import {
  apiPrincipalPolicyPageReader,
  type PrincipalPolicyHistoryReader,
} from "./principalPolicyHistoryReader";
import { createPrincipalCurrentRecoveryBatch } from "./recoveryOperation/principalCurrentRecoveryBatch";
import { recoverWithPrincipalLocalPreference } from "./recoveryOperation/principalRecoveryLocalPreference";

export interface PrincipalPolicyRecoveryRuntime {
  readonly apiClient: Partial<PrincipalPolicyHistoryReader>;
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
  const historyReader = apiPrincipalPolicyPageReader(runtime.apiClient);
  if (!lease || !historyReader) return undefined;
  const batches = new WeakMap<
    object,
    ReturnType<typeof createPrincipalCurrentRecoveryBatch>
  >();
  const recoverFor = (batch: object | undefined) => {
    if (!batch) return createPrincipalCurrentRecoveryBatch();
    let recover = batches.get(batch);
    if (!recover) {
      recover = createPrincipalCurrentRecoveryBatch();
      batches.set(batch, recover);
    }
    return recover;
  };
  return (input) =>
    getOrCreatePrincipalPolicyCoordinator(runtime.infra.execSql).queueRecovery(
      input.organizationId,
      () =>
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
                  historyReader,
                  execSql: runtime.infra.execSql,
                  offline,
                  organizationId: input.organizationId,
                  protection,
                  resolveTrustedUserIdentity:
                    runtime.resolveTrustedUserIdentity,
                  stillCurrent,
                };
                const batch = recoverFor(input.recoveryBatch);
                const result: ScopedPrincipalPolicyRecovery = input.reference
                  ? await recoverWithPrincipalLocalPreference(
                      batch.recover,
                      {
                        ...options,
                        reference: input.reference,
                        historyPage: input.historyPage,
                      },
                      input.preferLocalCurrent === true ||
                        input.preferLocalHistory === true,
                      input.preferLocalHistory === true,
                    )
                  : await batch.discover(options);
                // Reused evidence stays bound to every producer lifetime.
                const resultCurrent = () =>
                  stillCurrent() && result.stillCurrent();
                assertProjectionVerificationCurrent(resultCurrent);
                return {
                  current: result.current,
                  organizationId: input.organizationId,
                  policy: result.policy,
                  dependencies: result.dependencies,
                  historyPage: result.historyPage,
                  stillCurrent: resultCurrent,
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
