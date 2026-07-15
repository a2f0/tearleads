import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { principalPolicyHeadMeetsCheckpoint } from "../persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

/**
 * Cache key for a referenced principal policy. The in-memory principal-policy
 * cache is populated and read from several call sites; they must agree on this
 * format byte-for-byte or a populated entry looks uncached (extra warm fetches)
 * — so this is the single source of truth, imported rather than re-declared.
 */
export function referencedPrincipalPolicyKey(
  reference: ReferencedPrincipalHead,
): string {
  return `${reference.principalType}:${reference.principalId}:${reference.version}:${reference.stateHash}`;
}

export function principalPolicyCacheForVerifiedPolicies(
  policies: readonly VerifiedPrincipalPolicy[],
): Map<string, VerifiedPrincipalPolicy> {
  const cache = new Map<string, VerifiedPrincipalPolicy>();
  for (const policy of policies) {
    const states = policy.history?.map((entry) => entry.state) ?? [
      policy.state,
    ];
    for (const state of states) {
      cache.set(
        referencedPrincipalPolicyKey({
          principalType: state.principalType,
          principalId: state.principalId,
          version: state.version,
          keyEpoch: state.keyEpoch,
          stateHash: state.stateHash,
          keyFingerprint: state.keyFingerprint,
        }),
        policy,
      );
    }
  }
  return cache;
}

/** Flatten a bundle's previous + current states into one chain for matching. */
export function principalPolicyBundleStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

export function principalPolicyBundleContainsReference(
  bundle: PrincipalPolicyBundleResponse,
  reference: ReferencedPrincipalHead,
): boolean {
  return principalPolicyBundleStates(bundle).some(
    (state) =>
      state.principalType === reference.principalType &&
      state.principalId === reference.principalId &&
      state.version === reference.version &&
      state.keyEpoch === reference.keyEpoch &&
      state.stateHash === reference.stateHash &&
      state.keyFingerprint === reference.keyFingerprint,
  );
}

// Identify which referenced policies are absent from both the in-memory cache
// and local storage, so the warmer fetches only what is genuinely missing.
export async function filterUncachedPrincipalPolicyReferences(input: {
  execSql: ExecSql;
  principalPolicyCache: ReadonlyMap<string, VerifiedPrincipalPolicy>;
  references: readonly ReferencedPrincipalHead[];
}): Promise<ReferencedPrincipalHead[]> {
  const results = await Promise.all(
    input.references.map(async (reference) => {
      const checkpoint = await loadPrincipalPolicyCheckpoint(
        input.execSql,
        reference.principalType,
        reference.principalId,
      );
      const cachedPolicy = input.principalPolicyCache.get(
        referencedPrincipalPolicyKey(reference),
      );
      if (
        cachedPolicy &&
        principalPolicyHeadMeetsCheckpoint(cachedPolicy, checkpoint)
      ) {
        return null;
      }
      const bundle = await loadPrincipalPolicyBundle(
        input.execSql,
        reference.principalType,
        reference.principalId,
      );
      return bundle &&
        principalPolicyHeadMeetsCheckpoint(bundle.currentState, checkpoint) &&
        principalPolicyBundleContainsReference(bundle, reference)
        ? null
        : reference;
    }),
  );
  return results.filter(
    (reference): reference is ReferencedPrincipalHead => reference !== null,
  );
}
