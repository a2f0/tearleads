import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PrincipalPolicyRef } from "@tearleads/validators/request";
import { PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT } from "@tearleads/validators/util";
import {
  getCurrentPrincipalStates,
  type StoredPrincipalState,
} from "../../../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "../../../principals/getCurrentPrincipalPolicy";
import { assertPrincipalPolicyReadable } from "../../../principals/principalPolicyReadAuthorization";
import { loadPrincipalPolicyReferenceBatches } from "../../../principals/principalPolicyReferenceBatches";
import { PrincipalPolicyError } from "../../../principals/shared";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { mutationStateStale } from "../errors";

function principalPolicyKey(
  policy: Pick<PrincipalPolicyRef, "principalId" | "principalType">,
): string {
  return `${policy.principalType}:${policy.principalId}`;
}

async function loadCurrentStates(
  executor: DatabaseTransaction,
  refs: readonly PrincipalPolicyRef[],
): Promise<Map<string, StoredPrincipalState>> {
  const currentStateByPolicyKey = new Map<string, StoredPrincipalState>();

  for (const principalType of [
    ...new Set(refs.map((ref) => ref.principalType)),
  ]) {
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      refs
        .filter((ref) => ref.principalType === principalType)
        .map((ref) => ref.principalId),
      executor,
    );
    for (const state of currentStates.values()) {
      currentStateByPolicyKey.set(principalPolicyKey(state), state);
    }
  }

  return currentStateByPolicyKey;
}

async function stalePrincipalPolicyError(input: {
  readonly currentStateByPolicyKey: ReadonlyMap<string, StoredPrincipalState>;
  readonly executor: DatabaseTransaction;
  readonly refs: readonly PrincipalPolicyRef[];
  readonly requesterUserId: string;
}) {
  const seenPrincipalPolicyKeys = new Set<string>();
  const statesToFetch: StoredPrincipalState[] = [];
  // Return a bounded set of advisory heads. Clients recover their signed
  // evidence through ordinary pages before rebuilding a mutation.
  // Only principals the requester may read are returned: this reject runs before
  // the mutation's own authorization, so a fabricated stale entry naming any
  // principal must not turn it into an unauthorized policy read.
  for (const ref of input.refs) {
    const key = principalPolicyKey(ref);
    const currentState = input.currentStateByPolicyKey.get(key);
    if (seenPrincipalPolicyKeys.has(key) || !currentState) {
      continue;
    }

    seenPrincipalPolicyKeys.add(key);
    if (statesToFetch.length < PRINCIPAL_POLICY_REPAIR_HEAD_LIMIT) {
      statesToFetch.push(currentState);
    }
  }

  const context = createContainerWriterProjectionContext(input.executor);
  const principalHeads = (
    await gatherWithExecutor(
      input.executor,
      statesToFetch,
      async (currentState) => {
        try {
          await assertPrincipalPolicyReadable({
            context,
            currentState,
            executor: input.executor,
            requesterUserId: input.requesterUserId,
          });
        } catch (error) {
          if (error instanceof PrincipalPolicyError) return null;
          throw error;
        }
        const { bundle } = await getVerifiedPrincipalPolicyForStateWithExecutor(
          input.executor,
          currentState,
        );
        return {
          principalType: bundle.currentState.principalType,
          principalId: bundle.currentState.principalId,
          version: bundle.currentState.version,
          stateHash: bundle.currentState.stateHash,
          keyEpoch: bundle.currentState.keyEpoch,
          keyFingerprint: bundle.currentState.keyFingerprint,
        };
      },
    )
  ).filter((head) => head !== null);

  return mutationStateStale("Principal policy is stale", {
    code: "principal_policy_stale",
    error: "Principal policy is stale",
    principalHeads,
  });
}

/**
 * Each ref must name its principal's current head. The returned
 * authorizations are the server's own verified copies of those heads; the
 * request never carries policy bytes, since the head's `stateHash` commits
 * everything a policy holds.
 */
export async function assertPrincipalPoliciesCurrent(
  executor: DatabaseTransaction,
  principalPolicyRefs: readonly PrincipalPolicyRef[],
  options: {
    readonly referencedPrincipalHeads?: readonly ReferencedPrincipalHead[];
    readonly requesterUserId: string;
  },
): Promise<PrincipalPolicyAuthorization[]> {
  const refs = [
    ...new Map(
      principalPolicyRefs.map((ref) => [
        `${principalPolicyKey(ref)}:${ref.version}:${ref.stateHash}`,
        ref,
      ]),
    ).values(),
  ];
  const currentStateByPolicyKey = await loadCurrentStates(executor, refs);
  const staleRefs = refs.filter((ref) => {
    const currentState = currentStateByPolicyKey.get(principalPolicyKey(ref));
    return (
      currentState?.version !== ref.version ||
      currentState.stateHash !== ref.stateHash
    );
  });

  if (staleRefs.length > 0) {
    throw await stalePrincipalPolicyError({
      currentStateByPolicyKey,
      executor,
      refs: staleRefs,
      requesterUserId: options.requesterUserId,
    });
  }

  const referencedPrincipalHeads = options.referencedPrincipalHeads ?? [];
  const batches = await gatherWithExecutor(executor, refs, async (ref) => {
    const currentState = currentStateByPolicyKey.get(principalPolicyKey(ref));
    if (!currentState) {
      throw mutationStateStale("Principal policy is stale");
    }

    const storedBatches = await loadPrincipalPolicyReferenceBatches(
      executor,
      currentState,
      referencedPrincipalHeads.filter(
        (reference) =>
          reference.principalType === ref.principalType &&
          reference.principalId === ref.principalId,
      ),
    );
    return storedBatches.map(({ policy }) => policy);
  });
  return batches.flat();
}
