import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import {
  collectReferencedPrincipalHeads,
  loadPrincipalAuthorizationPoliciesForContainerPaths,
  loadPrincipalPoliciesForReferences,
  PrincipalPolicyProjectionError,
} from "../../principals/principalPolicyProjection";
import {
  ContainerWriterProjectionError,
  type PrincipalPolicyReferenceCache,
} from "./types";

export function principalPolicyReferenceCacheKey(
  principalHead: ReferencedPrincipalHead,
): string {
  return [
    principalHead.principalType,
    principalHead.principalId,
    principalHead.version,
    principalHead.keyEpoch,
    principalHead.stateHash,
    principalHead.keyFingerprint,
  ].join(":");
}

export async function loadHistoricalPrincipalPoliciesForAccessPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  evidence: readonly PrincipalPolicyAuthorization[],
): Promise<PrincipalPolicyAuthorization[]> {
  try {
    return await loadPrincipalAuthorizationPoliciesForContainerPaths(
      executor,
      paths,
      evidence,
    );
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      throw new ContainerWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
}

function verifiedPrincipalPolicyReferenceCacheKey(
  policy: PrincipalPolicyAuthorization,
): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.keyEpoch,
    policy.stateHash,
    policy.state.keyFingerprint,
  ].join(":");
}

function verifiedPrincipalPolicyStateReferenceCacheKey(
  state: PrincipalPolicyAuthorization["state"],
): string {
  return [
    state.principalType,
    state.principalId,
    state.version,
    state.keyEpoch,
    state.stateHash,
    state.keyFingerprint,
  ].join(":");
}

export function verifiedPrincipalPolicyReferenceCacheKeys(
  policy: PrincipalPolicyAuthorization,
): string[] {
  const referenceKeys = new Set([
    verifiedPrincipalPolicyReferenceCacheKey(policy),
  ]);

  const history =
    "retainedHistory" in policy ? policy.retainedHistory : policy.history;
  for (const entry of history ?? []) {
    referenceKeys.add(
      verifiedPrincipalPolicyStateReferenceCacheKey(entry.state),
    );
  }

  return [...referenceKeys].sort();
}

export function principalPolicyCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
}): string {
  const policyKeys = new Set(
    input.principalPolicies.flatMap(verifiedPrincipalPolicyReferenceCacheKeys),
  );

  return input.manifest.state.referencedPrincipalHeads
    .map((principalHead) => {
      const referenceKey = principalPolicyReferenceCacheKey(principalHead);

      return policyKeys.has(referenceKey)
        ? referenceKey
        : `missing:${referenceKey}`;
    })
    .sort()
    .join("|");
}

async function loadPoliciesForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
): Promise<PrincipalPolicyAuthorization[]> {
  try {
    return await loadPrincipalPoliciesForReferences(executor, references);
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      throw new ContainerWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
}

function policyForReference(
  policies: readonly PrincipalPolicyAuthorization[],
  reference: ReferencedPrincipalHead,
): PrincipalPolicyAuthorization | undefined {
  return policies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference }),
  );
}

/**
 * Loads through a request-scoped cache keyed by principal reference. A load
 * shares its in-flight promise with concurrent callers and is evicted when it
 * fails. A caller that borrowed a reference from a load that failed (possibly
 * because of another reference in it) loads that reference itself, so each
 * caller still fails only on its own references.
 */
async function loadPrincipalPoliciesThroughCache(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
  cache: PrincipalPolicyReferenceCache,
): Promise<PrincipalPolicyAuthorization[]> {
  const borrowed: {
    readonly promise: Promise<PrincipalPolicyAuthorization | undefined>;
    readonly reference: ReferencedPrincipalHead;
  }[] = [];
  const missing: ReferencedPrincipalHead[] = [];
  for (const reference of references) {
    const promise = cache.get(principalPolicyReferenceCacheKey(reference));
    if (promise) borrowed.push({ promise, reference });
    else missing.push(reference);
  }

  const ownLoad = loadPoliciesForReferences(executor, missing);
  const shared = missing.map((reference) => {
    const key = principalPolicyReferenceCacheKey(reference);
    const promise = ownLoad.then((policies) =>
      policyForReference(policies, reference),
    );
    // Borrowers handle a failure themselves; this only marks it handled.
    promise.catch(() => undefined);
    cache.set(key, promise);
    return { key, promise };
  });

  let ownPolicies: PrincipalPolicyAuthorization[];
  try {
    ownPolicies = await ownLoad;
  } catch (error) {
    for (const { key, promise } of shared) {
      if (cache.get(key) === promise) cache.delete(key);
    }
    throw error;
  }
  const policies = new Set(ownPolicies);
  const retry: ReferencedPrincipalHead[] = [];
  const settled = await Promise.allSettled(
    borrowed.map(({ promise }) => promise),
  );
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      if (result.value) policies.add(result.value);
      continue;
    }
    const entry = borrowed[index];
    if (entry) retry.push(entry.reference);
  }
  for (const policy of await loadPoliciesForReferences(executor, retry)) {
    policies.add(policy);
  }
  return [...policies];
}

export async function loadPrincipalPoliciesForAccessPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  evidence: readonly PrincipalPolicyAuthorization[] = [],
  cache?: PrincipalPolicyReferenceCache,
): Promise<PrincipalPolicyAuthorization[]> {
  const missing = collectReferencedPrincipalHeads(paths).filter(
    (reference) => !policyForReference(evidence, reference),
  );
  return [
    ...evidence,
    ...(cache
      ? await loadPrincipalPoliciesThroughCache(executor, missing, cache)
      : await loadPoliciesForReferences(executor, missing)),
  ];
}
