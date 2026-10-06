import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import { readPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import { PrincipalPolicyHistoryReadError } from "./principalHistoryRecoveryTypes";
import { isPrincipalRecoveryOutage } from "./principalRecoveryOutage";
import { queuePrincipalRecovery } from "./principalRecoveryQueue";
import {
  type ProjectionPolicyHistoryRecoveryOptions,
  recoverProjectionPolicyHistory,
} from "./recoverProjectionPolicyHistory";
import type { PrincipalPolicyRecoveryRuntime } from "./runtimePolicyRecovery";

async function recoverWithOutageFallback(
  options: ProjectionPolicyHistoryRecoveryOptions,
) {
  try {
    return await recoverProjectionPolicyHistory(options);
  } catch (error) {
    assertProjectionVerificationCurrent(options.stillCurrent);
    if (options.offline || !isPrincipalRecoveryOutage(error)) throw error;
    return recoverProjectionPolicyHistory({ ...options, offline: true });
  }
}

export function createRuntimeProjectionPolicyResolver(
  runtime: PrincipalPolicyRecoveryRuntime,
): ReferencedPrincipalPolicyWarmer["resolveProjectionHistory"] {
  const lease = readPrincipalHistoryProtection(runtime);
  const readPages = runtime.apiClient.getProjectionPolicyHistoryPages?.bind(
    runtime.apiClient,
  );
  if (!lease || !readPages) return undefined;
  return (input) =>
    queuePrincipalRecovery(runtime.infra.execSql, input.organizationId, () =>
      runWithSecurityIncidentReporting(
        runtime.util.reportSecurityIncident,
        {
          objectId: input.organizationId,
          objectKind: "principal",
          operation: "principal.projection.recover",
          organizationId: input.organizationId,
        },
        () =>
          lease(async ({ protection, stillCurrent: leaseCurrent }) => {
            const stillCurrent = () =>
              leaseCurrent() && input.stillCurrent?.() !== false;
            assertProjectionVerificationCurrent(stillCurrent);
            try {
              const policies = await recoverWithOutageFallback({
                ...input,
                apiClient: { getProjectionPolicyHistoryPages: readPages },
                execSql: runtime.infra.execSql,
                protection,
                stillCurrent,
                offline: runtime.state?.online === false,
                resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
              });
              return { policies, stillCurrent };
            } catch (error) {
              assertProjectionVerificationCurrent(stillCurrent);
              if (
                error instanceof PrincipalPolicyHistoryReadError ||
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
