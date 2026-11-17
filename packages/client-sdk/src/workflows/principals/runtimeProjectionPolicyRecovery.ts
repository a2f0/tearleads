import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import { getOrCreatePrincipalPolicyCoordinator } from "../../data/principals/principalPolicyCoordinator";
import { runWithSecurityIncidentReporting } from "../../data/shared/securityIncidents";
import { PrincipalPolicyHistoryReadError } from "./historyRecovery/principalHistoryRecoveryTypes";
import { apiProjectionPolicyHistoryReader } from "./principalPolicyHistoryReader";
import {
  type ProjectionPolicyHistoryRecoveryOptions,
  recoverProjectionPolicyHistory,
} from "./publicHistory/recoverProjectionPolicyHistory";
import { isPrincipalRecoveryOutage } from "./recoveryOperation/principalRecoveryOutage";
import type { PrincipalPolicyCollaborators } from "./runtimePolicyRecovery";

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

export function createProjectionPolicyHistoryResolver(
  collaborators: PrincipalPolicyCollaborators,
): ReferencedPrincipalPolicyWarmer["resolveProjectionHistory"] {
  const lease = collaborators.withPrincipalHistoryProtection;
  const historyReader = apiProjectionPolicyHistoryReader(
    collaborators.apiClient,
  );
  if (!lease || !historyReader) return undefined;
  return (input) =>
    getOrCreatePrincipalPolicyCoordinator(
      collaborators.infra.execSql,
    ).queueRecovery(input.organizationId, () =>
      runWithSecurityIncidentReporting(
        collaborators.util.reportSecurityIncident,
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
                historyReader,
                execSql: collaborators.infra.execSql,
                protection,
                stillCurrent,
                offline: collaborators.state?.online === false,
                resolveTrustedUserIdentity:
                  collaborators.resolveTrustedUserIdentity,
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
