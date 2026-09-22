import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicySignedState,
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
} from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  listPrincipalProjectionMembersForStates,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../../../access/read/principalStateStore";
import { canonicalJsonEquals } from "../../../../utils/canonicalJson";
import {
  getPrincipalPolicyForStateWithExecutor,
  getVerifiedPrincipalPolicyForStateWithExecutor,
} from "../../../principals/getCurrentPrincipalPolicy";
import { assertPrincipalPolicyReadable } from "../../../principals/principalPolicyReadAuthorization";
import { PrincipalPolicyError } from "../../../principals/shared";
import { ContainerMutationError, mutationStateStale } from "../errors";
import type { PrincipalPolicyRequestArtifact } from "./principalPolicyRecords";

function projectionMemberKey(
  member: Pick<PrincipalProjectionMember, "userId" | "role">,
): string {
  return [member.userId, member.role].join(":");
}

function projectionMemberFromStored(
  member: StoredPrincipalProjectionMember,
): PrincipalProjectionMember {
  return {
    userId: member.userId,
    role: member.role,
  };
}

function principalPolicyKey(
  policy: Pick<PrincipalPolicyRequestArtifact, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

function principalPolicyArtifactRecord(
  policy: PrincipalPolicyRequestArtifact,
  state: PrincipalPolicySignedState = policy.state,
): Record<string, unknown> {
  return {
    checkpoint: policy.checkpoint,
    grants: normalizePrincipalContainerGrants(policy.grants),
    keyEpoch: policy.keyEpoch,
    principalId: policy.principalId,
    principalType: policy.principalType,
    projection: normalizePrincipalProjectionMembers(policy.projection),
    state,
    stateHash: policy.stateHash,
    version: policy.version,
  };
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
  executor: DatabaseTransaction,
  principalPolicies: readonly PrincipalPolicyRequestArtifact[],
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

function principalPolicyMatchesReference(
  policy: PrincipalPolicyRequestArtifact,
  reference: ReferencedPrincipalHead,
): boolean {
  return (
    policy.principalType === reference.principalType &&
    policy.principalId === reference.principalId &&
    policy.version === reference.version &&
    policy.keyEpoch === reference.keyEpoch &&
    policy.stateHash === reference.stateHash &&
    policy.state.keyFingerprint === reference.keyFingerprint
  );
}

function principalPolicyNeedsStoredHistory(
  policy: PrincipalPolicyRequestArtifact,
  referencedPrincipalHeads: readonly ReferencedPrincipalHead[],
): boolean {
  return referencedPrincipalHeads.some(
    (reference) =>
      policy.principalType === reference.principalType &&
      policy.principalId === reference.principalId &&
      !principalPolicyMatchesReference(policy, reference),
  );
}

function isPrincipalPolicyStateCurrent(
  policy: PrincipalPolicyRequestArtifact,
  currentState: StoredPrincipalState | undefined,
): boolean {
  return Boolean(
    currentState &&
      currentState.version === policy.version &&
      currentState.keyEpoch === policy.keyEpoch &&
      currentState.stateHash === policy.stateHash &&
      currentState.keyFingerprint === policy.state.keyFingerprint,
  );
}

function isPrincipalPolicyProjectionCurrent(
  policy: PrincipalPolicyRequestArtifact,
  storedProjection: readonly StoredPrincipalProjectionMember[],
): boolean {
  const storedProjectionKeys = storedProjection
    .map(projectionMemberFromStored)
    .map(projectionMemberKey)
    .sort();
  const policyProjectionKeys = policy.projection
    .map(projectionMemberKey)
    .sort();

  return (
    storedProjectionKeys.length === policyProjectionKeys.length &&
    !storedProjectionKeys.some(
      (storedKey, index) => storedKey !== policyProjectionKeys[index],
    )
  );
}

async function stalePrincipalPolicyError(input: {
  readonly artifacts: PrincipalPolicyArtifacts;
  readonly executor: DatabaseTransaction;
  readonly message: string;
  readonly policies: readonly PrincipalPolicyRequestArtifact[];
  readonly requesterUserId: string;
}): Promise<ContainerMutationError> {
  const seenPrincipalPolicyKeys = new Set<string>();
  const statesToFetch: StoredPrincipalState[] = [];
  // A repair carries at most this many bundles; the rest are re-requested
  // on the retry. This also bounds the read-authorization work a request
  // with an unbounded `principalPolicies` array can demand.
  const MAX_STALE_POLICY_REPAIRS = 16;

  // Stale-policy rejects are repairable: return the server's current signed
  // bundles so the client can verify, cache, rebuild the mutation, and retry.
  // Only bundles the requester may read are returned: this reject runs before
  // the mutation's own authorization, so a fabricated stale entry naming any
  // principal must not turn it into an unauthenticated policy read.
  for (const policy of input.policies) {
    const key = principalPolicyKey(policy);
    const currentState = input.artifacts.currentStateByPolicyKey.get(key);
    if (seenPrincipalPolicyKeys.has(key) || !currentState) {
      continue;
    }

    seenPrincipalPolicyKeys.add(key);
    if (statesToFetch.length < MAX_STALE_POLICY_REPAIRS) {
      statesToFetch.push(currentState);
    }
  }

  const principalPolicies = (
    await gatherWithExecutor(
      input.executor,
      statesToFetch,
      async (currentState) => {
        try {
          await assertPrincipalPolicyReadable({
            currentState,
            executor: input.executor,
            requesterUserId: input.requesterUserId,
          });
        } catch (error) {
          if (error instanceof PrincipalPolicyError) return null;
          throw error;
        }
        return getPrincipalPolicyForStateWithExecutor(
          input.executor,
          currentState,
        );
      },
    )
  ).filter((bundle) => bundle !== null);

  return mutationStateStale(input.message, {
    code: "principal_policy_stale",
    error: input.message,
    principalPolicies,
  });
}

export async function assertPrincipalPoliciesCurrent(
  executor: DatabaseTransaction,
  principalPolicies: readonly PrincipalPolicyRequestArtifact[],
  options: {
    readonly referencedPrincipalHeads?: readonly ReferencedPrincipalHead[];
    readonly requesterUserId: string;
  },
): Promise<VerifiedPrincipalPolicy[]> {
  const artifacts = await loadPrincipalPolicyArtifacts(
    executor,
    principalPolicies,
  );
  const stalePolicies: PrincipalPolicyRequestArtifact[] = [];
  let staleMessage = "Principal policy is stale";

  for (const policy of principalPolicies) {
    const key = principalPolicyKey(policy);
    const currentState = artifacts.currentStateByPolicyKey.get(key);
    if (!isPrincipalPolicyStateCurrent(policy, currentState)) {
      stalePolicies.push(policy);
      continue;
    }

    if (
      !isPrincipalPolicyProjectionCurrent(
        policy,
        artifacts.projectionByPolicyKey.get(key) ?? [],
      )
    ) {
      staleMessage = "Principal policy projection is stale";
      stalePolicies.push(policy);
    }
  }

  if (stalePolicies.length > 0) {
    throw await stalePrincipalPolicyError({
      artifacts,
      executor,
      message: staleMessage,
      policies: stalePolicies,
      requesterUserId: options.requesterUserId,
    });
  }

  const referencedPrincipalHeads = options.referencedPrincipalHeads ?? [];
  return gatherWithExecutor(executor, principalPolicies, async (policy) => {
    const currentState = artifacts.currentStateByPolicyKey.get(
      principalPolicyKey(policy),
    );
    if (!currentState) {
      throw mutationStateStale("Principal policy is stale");
    }

    const stored = await getVerifiedPrincipalPolicyForStateWithExecutor(
      executor,
      currentState,
    );
    const { createdAt: _createdAt, ...storedSignedState } =
      stored.bundle.currentState;
    if (
      !canonicalJsonEquals(
        principalPolicyArtifactRecord(policy),
        principalPolicyArtifactRecord(stored.policy, storedSignedState),
      )
    ) {
      throw new ContainerMutationError(
        "Principal policy artifact does not match verified stored policy",
        409,
      );
    }
    if (
      principalPolicyNeedsStoredHistory(policy, referencedPrincipalHeads) &&
      !stored.policy.history
    ) {
      throw new ContainerMutationError(
        "Stored principal policy history is missing",
        409,
      );
    }
    return stored.policy;
  });
}
