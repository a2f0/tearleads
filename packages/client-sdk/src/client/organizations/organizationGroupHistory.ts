import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { buildOrganizationGroupPolicyHistoryPage } from "../../workflows/organizations/groupPolicyHistoryPage";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

/** Undefined means the host lacks paged recovery; a failed capability never downgrades. */
export async function loadBoundedOrganizationGroupHistory(input: {
  readonly active: ActiveOrganizationDataRuntime;
  readonly groupId: string;
  readonly beforeVersion?: number | undefined;
  readonly stillCurrent: () => boolean;
}) {
  const { active } = input;
  const resolve = createRuntimePrincipalPolicyCurrentResolver(active.runtime);
  if (!resolve) {
    if (input.beforeVersion !== undefined)
      throw new KeyingVerificationError(
        "invalid_shape",
        "This host cannot resolve a group history page cursor",
      );
    return undefined;
  }
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
