import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { buildOrganizationGroupPolicyHistoryPage } from "../../workflows/organizations/groupPolicyHistoryPage";
import { loadPolicyHistoryDetails } from "../../workflows/organizations/loadPolicyHistoryDetails";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import { createRuntimeProjectionPolicyResolver } from "../../workflows/principals/runtimeProjectionPolicyRecovery";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

export async function loadBoundedOrganizationHistory(input: {
  readonly active: ActiveOrganizationDataRuntime;
  readonly beforeVersion?: number | undefined;
  readonly stillCurrent: () => boolean;
}) {
  const { active, stillCurrent } = input;
  const { runtime } = active;
  const resolve = createRuntimePrincipalPolicyCurrentResolver(runtime);
  const resolveHistory = createRuntimeProjectionPolicyResolver(runtime);
  if (!resolve || !resolveHistory)
    throw new ProjectionDependencyUnavailableError(
      "Organization history requires private paged recovery",
    );
  const reference = await loadLocalOrganizationPolicyReference({
    currentUserId: active.userId,
    execSql: runtime.infra.execSql,
    organizationId: active.organizationId,
    principalId: active.organizationId,
    principalType: "organization",
  });
  assertProjectionVerificationCurrent(stillCurrent);
  if (!reference) return null;
  const resolved = await resolve({
    organizationId: active.organizationId,
    reference,
    preferLocalCurrent: true,
    stillCurrent,
    historyPage:
      input.beforeVersion === undefined
        ? {}
        : { beforeVersion: input.beforeVersion },
  });
  assertProjectionVerificationCurrent(stillCurrent);
  const page = resolved.historyPage;
  if (!page) throw new Error("Verified organization history page is missing");
  const basic = buildOrganizationGroupPolicyHistoryPage({
    page,
    organizationId: active.organizationId,
    groupId: active.organizationId,
  });
  return loadPolicyHistoryDetails({
    apiClient: runtime.apiClient,
    currentUserId: active.userId,
    domainScope: runtime.state.domainScope,
    execSql: runtime.infra.execSql,
    organizationId: active.organizationId,
    head: reference,
    page,
    history: {
      principalId: active.organizationId,
      principalType: "organization",
      organizationId: active.organizationId,
      nextBeforeVersion: page.nextBeforeVersion,
      entries: basic.entries.map((entry) => ({ ...entry, groupChanges: null })),
    },
    resolveHistory,
    stillCurrent,
    online: runtime.state.online,
    olderPage: input.beforeVersion !== undefined,
    logError: runtime.util.logError,
    reportSecurityIncident: runtime.util.reportSecurityIncident,
  });
}
