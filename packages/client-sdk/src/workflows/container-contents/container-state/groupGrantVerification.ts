import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import {
  type ProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { principalPolicyBundleContainsReference } from "../../../data/principalPolicyStates";
import {
  advanceVerifiedSharePolicies,
  loadVerifiedGroupSharePrincipalPolicy,
  referencedPrincipalHeadFromPolicy,
} from "../../containers";
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

export async function containerStateHasCurrentGroupGrant(input: {
  accessLevel: GroupGrantAccessLevel;
  containerState: ContainerState;
  expectedContainerId: string;
  expectedGroupHead: ReferencedPrincipalHead;
  expectedOrganizationId: string;
  groupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<boolean> {
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (
    !projection ||
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

  const { bundle, checkpointPolicies, dependencyBundles, policy } =
    await loadVerifiedGroupSharePrincipalPolicy({
      apiClient: input.runtime.apiClient,
      execSql: input.runtime.infra.execSql,
      expectedGroupHead: input.expectedGroupHead,
      groupId: input.groupId,
      organizationId: input.expectedOrganizationId,
      resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    });
  if (
    !principalPolicyBundleContainsReference(bundle, input.expectedGroupHead)
  ) {
    return false;
  }
  const currentHead = referencedPrincipalHeadFromPolicy(policy);
  await advanceVerifiedSharePolicies(input.runtime.infra.execSql, {
    checkpointPolicies,
    dependencyBundles,
    organizationId: input.expectedOrganizationId,
  });
  await verifyContainerWriterProjection({
    execSql: input.runtime.infra.execSql,
    principalPolicyCache:
      principalPolicyCacheForVerifiedPolicies(checkpointPolicies),
    projection,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  const isCurrent = projectionHasCurrentGroupGrant({
    accessLevel: input.accessLevel,
    currentHead,
    expectedContainerId: input.expectedContainerId,
    expectedOrganizationId: input.expectedOrganizationId,
    groupId: input.groupId,
    projection,
  });
  if (isCurrent) {
    try {
      await savePrincipalPolicyBundle(
        input.runtime.infra.execSql,
        bundle,
        new Date().toISOString(),
        input.expectedOrganizationId,
      );
    } catch {
      // The cryptographically verified root grant is already safe. A local
      // cache failure must not keep it pending or trigger duplicate re-wraps.
    }
  }
  return isCurrent;
}
