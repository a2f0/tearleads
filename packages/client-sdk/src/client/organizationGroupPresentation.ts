import { loadOrganizationGroupSupportingDetails } from "../workflows/organizations";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

export async function loadOrganizationGroupPresentationDetails(input: {
  readonly groupId: string;
  readonly readModelCoordinator: OrganizationReadModelCoordinator;
  readonly runtime: InternalWorkflowRuntimeInput;
}) {
  const organizationId = input.runtime.auth.organizationId;
  if (
    !input.runtime.auth.isAuthenticated ||
    !organizationId ||
    input.groupId.length === 0
  ) {
    return {
      members: null,
      containers: null,
      policyHistory: null,
    };
  }

  const [members, supportingDetails] = await Promise.all([
    input.readModelCoordinator.loadLocalGroupMembers(
      input.groupId,
      organizationId,
    ),
    loadOrganizationGroupSupportingDetails({
      apiClient: input.runtime.apiClient,
      execSql:
        input.runtime.infra.dbStatus === "ready"
          ? input.runtime.infra.execSql
          : null,
      groupId: input.groupId,
      organizationId,
    }),
  ]);
  return { members, ...supportingDetails };
}
