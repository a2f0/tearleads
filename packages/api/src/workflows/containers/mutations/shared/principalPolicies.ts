import type {
  PrincipalProjectionMember,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../../../access/read/principalStateStore";
import type { DatabaseExecutor } from "../../../../adapters/postgres";
import { ContainerMutationError } from "../errors";

function projectionMemberKey(
  member: Pick<
    PrincipalProjectionMember,
    "memberPrincipalId" | "memberPrincipalType" | "role"
  >,
): string {
  return [
    member.memberPrincipalType,
    member.memberPrincipalId,
    member.role,
  ].join(":");
}

function principalPolicyKey(
  policy: Pick<VerifiedPrincipalPolicy, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

function principalProjectionStateKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

interface PrincipalPolicyArtifacts {
  readonly currentStateByPolicyKey: Map<string, StoredPrincipalState>;
  readonly projectionByPolicyKey: Map<
    string,
    StoredPrincipalProjectionMember[]
  >;
}

async function loadPrincipalPolicyArtifacts(
  executor: DatabaseExecutor,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<PrincipalPolicyArtifacts> {
  const currentStateByPolicyKey = new Map<string, StoredPrincipalState>();
  const projectionByPolicyKey = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const principalType of [
    ...new Set(principalPolicies.map((policy) => policy.principalType)),
  ]) {
    const policiesForType = principalPolicies.filter(
      (policy) => policy.principalType === principalType,
    );
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      policiesForType.map((policy) => policy.principalId),
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        currentStateByPolicyKey.set(principalPolicyKey(policy), currentState);
      }
    }

    const projections = await listPrincipalProjectionMembersForStates(
      principalType,
      [...currentStates.values()],
      executor,
    );

    for (const policy of policiesForType) {
      const currentState = currentStates.get(policy.principalId);
      if (currentState) {
        projectionByPolicyKey.set(
          principalPolicyKey(policy),
          projections.get(principalProjectionStateKey(currentState)) ?? [],
        );
      }
    }
  }

  return { currentStateByPolicyKey, projectionByPolicyKey };
}

function assertPrincipalPolicyStateCurrent(
  policy: VerifiedPrincipalPolicy,
  currentState: StoredPrincipalState | undefined,
): void {
  if (
    !currentState ||
    currentState.version !== policy.version ||
    currentState.keyEpoch !== policy.keyEpoch ||
    currentState.stateHash !== policy.stateHash ||
    currentState.keyFingerprint !== policy.state.keyFingerprint
  ) {
    throw new ContainerMutationError("Principal policy is stale", 409);
  }
}

function assertPrincipalPolicyProjectionCurrent(
  policy: VerifiedPrincipalPolicy,
  storedProjection: readonly StoredPrincipalProjectionMember[],
): void {
  const storedProjectionKeys = storedProjection.map(projectionMemberKey).sort();
  const policyProjectionKeys = policy.projection
    .map(projectionMemberKey)
    .sort();

  if (
    storedProjectionKeys.length !== policyProjectionKeys.length ||
    storedProjectionKeys.some(
      (storedKey, index) => storedKey !== policyProjectionKeys[index],
    )
  ) {
    throw new ContainerMutationError(
      "Principal policy projection is stale",
      409,
    );
  }
}

export async function assertPrincipalPoliciesCurrent(
  executor: DatabaseExecutor,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<void> {
  const artifacts = await loadPrincipalPolicyArtifacts(
    executor,
    principalPolicies,
  );

  for (const policy of principalPolicies) {
    const key = principalPolicyKey(policy);
    assertPrincipalPolicyStateCurrent(
      policy,
      artifacts.currentStateByPolicyKey.get(key),
    );
    assertPrincipalPolicyProjectionCurrent(
      policy,
      artifacts.projectionByPolicyKey.get(key) ?? [],
    );
  }
}
