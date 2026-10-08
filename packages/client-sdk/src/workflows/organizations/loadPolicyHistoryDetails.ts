import type { ApiClient } from "@tearleads/api-client";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { DomainScope } from "../../data/domainScope";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { reportKeyingVerificationErrorInCauseChain } from "../../data/keyingProjectionVerification/error";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification/types";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { RecoveredPrincipalHistoryPage } from "../principals/loadRecoveredPrincipalHistoryPage";
import { loadLocalOrganizationPolicyReference } from "./localReadModelDetails";
import { buildDetailedOrganizationPolicyHistory } from "./organizationPolicyHistoryDetails";
import {
  captureOrganizationPresentationAccessAttempt,
  isOrganizationPresentationAccessAttemptCurrent,
  isOrganizationPresentationAccessReadable,
} from "./organizationPresentationAccessState";
import { isOrganizationPresentationAccessDeniedFailure } from "./organizationPresentationFailures";
import { denyPolicyHistoryAccess } from "./policyHistoryAccessDenial";
import {
  cachePolicyHistory,
  loadCachedPolicyHistory,
} from "./policyHistoryCache";
import type { OrganizationPolicyHistory } from "./policyHistoryTypes";

export async function loadPolicyHistoryDetails(input: {
  apiClient: Pick<ApiClient, "getOrganizationPolicyHistoryResult">;
  currentUserId: string;
  domainScope: DomainScope;
  execSql: ExecSql;
  organizationId: string;
  head: ReferencedPrincipalHead;
  page: RecoveredPrincipalHistoryPage;
  history: OrganizationPolicyHistory;
  resolveHistory: NonNullable<
    ReferencedPrincipalPolicyWarmer["resolveProjectionHistory"]
  >;
  stillCurrent: () => boolean;
  online: boolean;
  olderPage: boolean;
  reportSecurityIncident?: SecurityIncidentReporter | undefined;
  // Forwarded to denyPolicyHistoryAccess to report failed durable cleanup.
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
  if (!current()) return null;
  const beforeVersion = (input.page.entries.at(-1)?.state.version ?? 0) + 1;
  const cache = {
    domainScope: input.domainScope,
    access,
    stateHash: input.head.stateHash,
    beforeVersion,
  };
  const retain = async (history: OrganizationPolicyHistory) => {
    const latest = await loadLocalOrganizationPolicyReference({
      ...input,
      principalType: "organization",
      principalId: input.organizationId,
    });
    return current() && latest?.stateHash === input.head.stateHash
      ? history
      : null;
  };
  const cached = loadCachedPolicyHistory(cache);
  if (cached) return retain(cached);
  if (!input.online) return retain(input.history);
  try {
    const response = await input.apiClient.getOrganizationPolicyHistoryResult(
      input.organizationId,
      input.head.stateHash,
      { beforeVersion, reportErrors: false },
    );
    if (!input.stillCurrent()) return null;
    if (!response.ok) {
      if (isOrganizationPresentationAccessDeniedFailure(response)) {
        await denyPolicyHistoryAccess(access);
        return null;
      }
      response.report();
      if (input.olderPage) throw new Error(response.message);
      return retain(input.history);
    }
    const history = await buildDetailedOrganizationPolicyHistory({
      head: input.head,
      page: input.page,
      evidence: response.data,
      resolveHistory: input.resolveHistory,
      stillCurrent: current,
    });
    const retained = await retain(history);
    if (retained === history)
      cachePolicyHistory({ ...cache, attempt, history });
    return retained;
  } catch (error) {
    if (
      !input.olderPage &&
      error instanceof ProjectionDependencyUnavailableError
    )
      return retain(input.history);
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
    throw error;
  }
}
