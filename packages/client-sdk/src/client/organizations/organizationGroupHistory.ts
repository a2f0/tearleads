import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { buildOrganizationGroupPolicyHistoryPage } from "../../workflows/organizations/groupPolicyHistoryPage";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

/** All group history reads use the private paged verifier. */
export async function loadBoundedOrganizationGroupHistory(input: {
  readonly active: ActiveOrganizationDataRuntime;
  readonly groupId: string;
  readonly beforeVersion?: number | undefined;
  readonly stillCurrent: () => boolean;
}) {
  const { active } = input;
  const resolve = createRuntimePrincipalPolicyCurrentResolver(active.runtime);
  if (!resolve)
    throw new ProjectionDependencyUnavailableError(
      "Group history requires private paged recovery",
    );
  assertProjectionVerificationCurrent(input.stillCurrent);
  const reference = await loadLocalOrganizationPolicyReference({
    currentUserId: active.userId,
    execSql: active.runtime.infra.execSql,
    organizationId: active.organizationId,
    principalId: input.groupId,
    principalType: "group",
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (!reference) return null;
  const resolved = await resolve({
    organizationId: active.organizationId,
    reference,
    preferLocalCurrent: true,
    stillCurrent: input.stillCurrent,
    historyPage:
      input.beforeVersion === undefined
        ? {}
        : { beforeVersion: input.beforeVersion },
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  if (!resolved.historyPage)
    throw new Error("Verified history page is missing");
  return buildOrganizationGroupPolicyHistoryPage({
    page: resolved.historyPage,
    groupId: input.groupId,
    organizationId: active.organizationId,
  });
}
