import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { createRuntimeCurrentSharePrincipalPolicy } from "../../containers/child/currentSharePrincipalPolicy";
import type { ContainerWorkflowRuntime } from "./types";

export async function resolveCurrentGroupKeyEpoch(input: {
  // Bound here, in the one verified load a duplicate share performs, so a
  // duplicate never reports success for a group the user did not choose.
  expectedGroupName?: string | undefined;
  groupId: string;
  organizationId: string;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<number | null> {
  if (input.stillCurrent?.() === false) return null;
  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(input.runtime);
  if (!readCurrent)
    throw new ProjectionDependencyUnavailableError(
      "Group sharing requires private paged recovery",
    );
  return readCurrent(
    {
      expectedGroupName: input.expectedGroupName,
      groupId: input.groupId,
      organizationId: input.organizationId,
      stillCurrent: input.stillCurrent ?? (() => true),
    },
    async ({ policy }) => policy.keyEpoch,
  );
}
