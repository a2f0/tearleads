import { loadOrganizationGroupPolicyHistory } from "../workflows/organizations";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

async function loadLocalFirstGroupPolicyHistory(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly readModelCoordinator: OrganizationReadModelCoordinator;
  readonly runtime: InternalWorkflowRuntimeInput;
}) {
  try {
    const localHistory =
      await input.readModelCoordinator.loadLocalGroupPolicyHistory(
        input.groupId,
        input.organizationId,
      );
    if (localHistory) {
      return localHistory;
    }
  } catch (error) {
    input.runtime.util.logError(
      "Failed to load local organization group policy history",
      error,
    );
  }

  return loadOrganizationGroupPolicyHistory({
    apiClient: input.runtime.apiClient,
    groupId: input.groupId,
  });
}

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
    loadLocalFirstGroupPolicyHistory({
      groupId: input.groupId,
      organizationId,
      readModelCoordinator: input.readModelCoordinator,
      runtime: input.runtime,
    }),
  ]);
  return { members, policyHistory };
}
