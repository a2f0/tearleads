import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import {
  type ProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import {
  principalPolicyBundleContainsReference,
  referencedPrincipalPolicyKey,
} from "../../../data/keyingProjectionVerification/principalPolicyCache";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { loadVerifiedGroupSharePrincipalPolicy } from "../../containers";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerState } from "../remoteHydration";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import type { ContainerWorkflowRuntime } from "./types";

type GroupGrantAccessLevel = "read" | "write" | "admin";

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

  const { bundle, policy } = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.runtime.apiClient,
    execSql: input.runtime.infra.execSql,
    groupId: input.groupId,
    organizationId: input.expectedOrganizationId,
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
  await verifyContainerWriterProjection({
    execSql: input.runtime.infra.execSql,
    principalPolicyCache: new Map([
      [referencedPrincipalPolicyKey(currentHead), policy],
    ]),
    projection,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });

  const state = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  const isCurrent =
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
        head.principalType === currentHead.principalType &&
        head.principalId === currentHead.principalId &&
        head.version === currentHead.version &&
        head.keyEpoch === currentHead.keyEpoch &&
        head.stateHash === currentHead.stateHash &&
        head.keyFingerprint === currentHead.keyFingerprint,
    );
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
