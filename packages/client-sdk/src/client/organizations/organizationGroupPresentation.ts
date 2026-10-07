import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";

export async function loadOrganizationGroupPresentationDetails(input: {
  readonly groupId: string;
  readonly beforeVersion?: number | undefined;
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
    input.beforeVersion === undefined
      ? input.readModelCoordinator.loadLocalGroupMembers(
          input.groupId,
          organizationId,
        )
      : Promise.resolve(null),
    input.readModelCoordinator
      .loadGroupPolicyHistory(
        input.groupId,
        organizationId,
        input.beforeVersion,
      )
      .catch((error: unknown) => {
        // Missing history must not hide the independent member projection.
        // Older-page failures remain explicit so the caller can retry them.
        if (
          input.beforeVersion === undefined &&
          error instanceof ProjectionDependencyUnavailableError
        ) {
          input.runtime.util.logError("Group history is unavailable", error);
          return null;
        }
        throw error;
      }),
  ]);
  return { members, policyHistory };
}
