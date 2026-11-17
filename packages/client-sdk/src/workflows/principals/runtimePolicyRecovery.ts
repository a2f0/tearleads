import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  type PrincipalPolicyResolveRequest,
  type ResolvedPrincipalPolicyEvidence,
} from "../../data/keyingProjectionVerification/types";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import {
  getOrCreatePrincipalPolicyCoordinator,
  type PrincipalPolicyCoordinator,
} from "../../data/principals/principalPolicyCoordinator";
import { ProjectionDependencyUnavailableError } from "../../data/shared/dependencyUnavailable";
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
import { resumeAfterSupersededStage } from "./recoveryOperation/supersededStageResume";

/**
 * The slices of one runtime snapshot a `PrincipalPolicyService` reads. Each
 * service method reads them when it is called and its resolvers per request,
 * as the snapshot's other consumers do. The lease is the snapshot's bound
 * history custody; the service never binds one itself.
 */
export interface PrincipalPolicyCollaborators {
  readonly apiClient: Partial<PrincipalPolicyHistoryReader>;
  readonly infra: { readonly execSql: ExecSql };
  readonly state?: { readonly online: boolean } | undefined;
  readonly util: {
    readonly reportSecurityIncident: SecurityIncidentReporter;
    readonly log?: ((message: string) => void) | undefined;
  };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly withPrincipalHistoryProtection?:
    | PrincipalHistoryProtectionLease
    | undefined;
}

export interface ResolvedPrincipalPolicyCurrent
  extends ResolvedPrincipalPolicyEvidence {
  readonly current: PrincipalPolicyPageCurrent;
  /** Rows end at the selected reference; current/policy may describe a newer recovered head. */
  readonly historyPage?: RecoveredPrincipalHistoryPage | undefined;
}

export interface PrincipalPolicyCurrentRequest
  extends Omit<PrincipalPolicyResolveRequest, "reference"> {
  readonly reference?: PrincipalPolicyResolveRequest["reference"] | undefined;
  /** A read-model caller has selected this exact signed head; not a freshness read. */
  readonly preferLocalCurrent?: boolean | undefined;
  readonly historyPage?: { readonly beforeVersion?: number } | undefined;
}

export type PrincipalPolicyCurrentResolver = (
  input: PrincipalPolicyCurrentRequest,
) => Promise<ResolvedPrincipalPolicyCurrent>;

type PrincipalCurrentRecoveryBatch = ReturnType<
  typeof createPrincipalCurrentRecoveryBatch
>;

/**
 * Operation batches belong to the database's coordinator, keyed by the
 * operation token, so every resolver and warmer one operation creates for that
 * database shares one authenticated view. A batch dies with its token (the end
 * of the pass or workflow) and its entries with any organization hint.
 */
const operationBatches = new WeakMap<
  PrincipalPolicyCoordinator,
  WeakMap<object, PrincipalCurrentRecoveryBatch>
>();

function operationRecoveryBatch(
  coordinator: PrincipalPolicyCoordinator,
  operation: object | undefined,
): PrincipalCurrentRecoveryBatch {
  if (!operation) return createPrincipalCurrentRecoveryBatch();
  let batches = operationBatches.get(coordinator);
  if (!batches) {
    batches = new WeakMap();
    operationBatches.set(coordinator, batches);
  }
  let batch = batches.get(operation);
  if (!batch) {
    batch = createPrincipalCurrentRecoveryBatch();
    batches.set(operation, batch);
  }
  return batch;
}

/** One recovery attempt for a resolver request through the operation's batch. */
function recoverPolicyCurrent(
  batch: ReturnType<typeof createPrincipalCurrentRecoveryBatch>,
  options: Parameters<
    ReturnType<typeof createPrincipalCurrentRecoveryBatch>["discover"]
  >[0],
  input: PrincipalPolicyCurrentRequest,
): Promise<ScopedPrincipalPolicyRecovery> {
  return input.reference
    ? recoverWithPrincipalLocalPreference(
        batch.recover,
        {
          ...options,
          reference: input.reference,
          historyPage: input.historyPage,
        },
        input.preferLocalCurrent === true || input.preferLocalHistory === true,
        input.preferLocalHistory === true,
      )
    : batch.discover(options);
}

/** Keep current artifacts with their verified evidence and private snapshot lifetime. */
export function createPrincipalPolicyCurrentResolver(
  policies: PrincipalPolicyCollaborators,
): PrincipalPolicyCurrentResolver | undefined {
  const lease = policies.withPrincipalHistoryProtection;
  const historyReader = apiPrincipalPolicyPageReader(policies.apiClient);
  if (!lease || !historyReader) return undefined;
  const coordinator = getOrCreatePrincipalPolicyCoordinator(
    policies.infra.execSql,
  );
  return (input) =>
    coordinator.queueRecovery(input.organizationId, () =>
      runWithSecurityIncidentReporting(
        policies.util.reportSecurityIncident,
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
            const offline = policies.state?.online === false;
            try {
              const options = {
                historyReader,
                execSql: policies.infra.execSql,
                offline,
                organizationId: input.organizationId,
                protection,
                resolveTrustedUserIdentity: policies.resolveTrustedUserIdentity,
                stillCurrent,
              };
              const result = await resumeAfterSupersededStage(
                () =>
                  recoverPolicyCurrent(
                    operationRecoveryBatch(coordinator, input.recoveryBatch),
                    options,
                    input,
                  ),
                stillCurrent,
              );
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
