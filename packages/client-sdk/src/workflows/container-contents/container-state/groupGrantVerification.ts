import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import {
  nullOnProjectionVerificationCancellation,
  type ProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { referencedPrincipalHeadFromPolicy } from "../../containers";
import { createRuntimeCurrentSharePrincipalPolicy } from "../../containers/child/currentSharePrincipalPolicy";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerState } from "../remoteHydration";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import type { ContainerWorkflowRuntime } from "./types";

type GroupGrantAccessLevel = "read" | "write" | "admin";

function projectionHasCurrentGroupGrant(input: {
  accessLevel: GroupGrantAccessLevel;
  expectedContainerId: string;
  expectedOrganizationId: string;
  groupId: string;
  currentHead: ReferencedPrincipalHead;
  projection: NonNullable<
    Awaited<ReturnType<typeof loadContainerWriterProjectionForState>>
  >;
}): boolean {
  const state = readContainerState(
    getTargetContainerContext(input.projection).manifest,
  );
  return (
    state.containerId === input.expectedContainerId &&
    state.organizationId === input.expectedOrganizationId &&
    state.directGrants.some(
      (grant) =>
        grant.subjectType === "group" &&
        grant.subjectId === input.groupId &&
        grant.accessLevel === input.accessLevel,
    ) &&
    state.referencedPrincipalHeads.some(
      (head) =>
        head.principalType === input.currentHead.principalType &&
        head.principalId === input.currentHead.principalId &&
        head.version === input.currentHead.version &&
        head.keyEpoch === input.currentHead.keyEpoch &&
        head.stateHash === input.currentHead.stateHash &&
        head.keyFingerprint === input.currentHead.keyFingerprint,
    )
  );
}

async function containerStateHasCurrentGroupGrantInternal(input: {
  accessLevel: GroupGrantAccessLevel;
  containerState: ContainerState;
  expectedContainerId: string;
  expectedGroupHead: ReferencedPrincipalHead;
  expectedOrganizationId: string;
  groupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  if (input.stillCurrent?.() === false) return false;
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (
    !projection ||
    input.stillCurrent?.() === false ||
    input.expectedGroupHead.principalType !== "group" ||
    input.expectedGroupHead.principalId !== input.groupId ||
    input.containerState.container.id !== input.expectedContainerId ||
    input.containerState.container.organizationId !==
      input.expectedOrganizationId ||
    projection.containerId !== input.expectedContainerId ||
    projection.organizationId !== input.expectedOrganizationId
  ) {
    return false;
  }

  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(input.runtime);
  if (!readCurrent)
    throw new Error("Group sharing requires private paged recovery");
  return readCurrent(
    {
      expectedGroupHead: input.expectedGroupHead,
      groupId: input.groupId,
      organizationId: input.expectedOrganizationId,
      stillCurrent: input.stillCurrent ?? (() => true),
    },
    async ({ checkpointPolicies, policy, stillCurrent }) => {
      await verifyContainerWriterProjection({
        execSql: input.runtime.infra.execSql,
        principalPolicyCache:
          principalPolicyCacheForVerifiedPolicies(checkpointPolicies),
        projection,
        resolveUserKey: input.resolveProjectionUserKey,
        stillCurrent,
        warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
          input.runtime,
        ),
      });
      return projectionHasCurrentGroupGrant({
        accessLevel: input.accessLevel,
        currentHead: referencedPrincipalHeadFromPolicy(policy),
        expectedContainerId: input.expectedContainerId,
        expectedOrganizationId: input.expectedOrganizationId,
        groupId: input.groupId,
        projection,
      });
    },
  );
}

export async function containerStateHasCurrentGroupGrant(
  input: Parameters<typeof containerStateHasCurrentGroupGrantInternal>[0],
): Promise<boolean> {
  return (
    (await nullOnProjectionVerificationCancellation(() =>
      containerStateHasCurrentGroupGrantInternal(input),
    )) ?? false
  );
}
