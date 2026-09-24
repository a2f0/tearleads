import type { ApiClient } from "@tearleads/api-client";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { loadLocalOrganizationPolicyHistory } from "./localReadModelDetails";
import { buildDetailedOrganizationPolicyHistory } from "./organizationPolicyHistoryDetails";
import {
  captureOrganizationPresentationAccessAttempt,
  isOrganizationPresentationAccessAttemptCurrent,
  isOrganizationPresentationAccessReadable,
} from "./organizationPresentationAccessState";
import { isOrganizationPresentationAccessDeniedFailure } from "./organizationPresentationFailures";
import { denyPolicyHistoryAccess } from "./policyHistoryAccessDenial";
import type { OrganizationPolicyHistory } from "./policyHistoryTypes";

export async function loadPolicyHistoryDetails(input: {
  apiClient: Pick<ApiClient, "getOrganizationPolicyHistoryResult">;
  currentUserId: string;
  execSql: ExecSql;
  organizationId: string;
  history: OrganizationPolicyHistory;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  stillCurrent: () => boolean;
  reportSecurityIncident?: SecurityIncidentReporter | undefined;
  logError: (message: string | Error, cause?: unknown) => void;
}): Promise<OrganizationPolicyHistory | null> {
  const access = { ...input, requesterUserId: input.currentUserId };
  const attempt = captureOrganizationPresentationAccessAttempt(
    access,
    "readModel",
  );
  const current = () =>
    input.stillCurrent() &&
    isOrganizationPresentationAccessAttemptCurrent(access, attempt) &&
    isOrganizationPresentationAccessReadable(access, "readModel");
  const bundle = await loadPrincipalPolicyBundle(
    input.execSql,
    "organization",
    input.organizationId,
  );
  if (!current()) return null;
  if (
    !bundle ||
    bundle.currentState.stateHash !== input.history.entries[0]?.stateHash
  ) {
    const latest = await loadLocalOrganizationPolicyHistory(input);
    return current() ? latest : null;
  }
  const retain = async (history: OrganizationPolicyHistory) => {
    const latest = await loadLocalOrganizationPolicyHistory(input);
    if (!current()) return null;
    return latest?.entries[0]?.stateHash === bundle.currentState.stateHash
      ? history
      : latest;
  };
  try {
    const response = await input.apiClient.getOrganizationPolicyHistoryResult(
      input.organizationId,
      bundle.currentState.stateHash,
      { reportErrors: false },
    );
    if (!input.stillCurrent()) return null;
    if (!response.ok) {
      if (isOrganizationPresentationAccessDeniedFailure(response)) {
        await denyPolicyHistoryAccess(access);
        return null;
      }
      response.report();
      return retain(input.history);
    }
    const history = await buildDetailedOrganizationPolicyHistory({
      bundle,
      evidence: response.data,
      organizationId: input.organizationId,
      localCheckpoint: await loadPrincipalPolicyCheckpoint(
        input.execSql,
        "organization",
        input.organizationId,
      ),
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    return retain(history);
  } catch (error) {
    await reportKeyingVerificationErrorInCauseChain(
      error,
      input.reportSecurityIncident,
      {
        objectId: input.organizationId,
        objectKind: "principal",
        operation: "organization.policy_history.load",
        organizationId: input.organizationId,
      },
    );
    input.logError(
      "Failed to load verified organization policy history details",
      error,
    );
    return retain(input.history);
  }
}
