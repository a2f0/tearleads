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
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { principalPolicyBundleContainsReference } from "../../../data/principalPolicyStates";
import { loadVerifiedGroupSharePrincipalPolicy } from "../../containers";
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

async function saveDependencyBundles(
  execSql: ContainerWorkflowRuntime["infra"]["execSql"],
  bundles: readonly Parameters<typeof savePrincipalPolicyBundle>[1][],
): Promise<void> {
  for (const bundle of bundles) {
    await savePrincipalPolicyBundle(execSql, bundle, new Date().toISOString());
  }
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
      deferCheckpointAdvance: true,
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
  const currentHead = {
    principalType: policy.principalType,
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  } satisfies ReferencedPrincipalHead;
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.runtime.infra.execSql,
    policies: checkpointPolicies,
  });
  await saveDependencyBundles(input.runtime.infra.execSql, dependencyBundles);
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
      );
    } catch {
      // The cryptographically verified root grant is already safe. A local
      // cache failure must not keep it pending or trigger duplicate re-wraps.
    }
  }
  return isCurrent;
}
