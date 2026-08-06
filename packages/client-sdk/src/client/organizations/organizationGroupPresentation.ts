import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";

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
      policyHistory: null,
    };
  }

  const [members, policyHistory] = await Promise.all([
    input.readModelCoordinator.loadLocalGroupMembers(
      input.groupId,
      organizationId,
    ),
    input.readModelCoordinator.loadGroupPolicyHistory(
      input.groupId,
      organizationId,
    ),
  ]);
  return { members, policyHistory };
}
