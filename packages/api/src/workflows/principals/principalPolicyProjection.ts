import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  AnyVerifiedPrincipalPolicy,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  type PrincipalStateReference,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "./principalPolicySnapshots";
import { PrincipalPolicyError } from "./shared";

export class PrincipalPolicyProjectionError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "PrincipalPolicyProjectionError";
  }
}

function principalIdentityKey(input: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${input.principalType}:${input.principalId}`;
}

function collectReferencedPrincipalHeads(
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): ReferencedPrincipalHead[] {
  const headsByReference = new Map<string, ReferencedPrincipalHead>();

  for (const path of paths) {
    for (const manifest of path) {
      for (const principalHead of manifest.state.referencedPrincipalHeads) {
        headsByReference.set(principalStateReferenceKey(principalHead), {
          ...principalHead,
        });
      }
    }
  }

  return Array.from(headsByReference.values()).sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}

function dedupeReferencedPrincipalHeads(
  references: readonly ReferencedPrincipalHead[],
): ReferencedPrincipalHead[] {
  const headsByReference = new Map<string, ReferencedPrincipalHead>();
  for (const reference of references) {
    headsByReference.set(principalStateReferenceKey(reference), {
      ...reference,
    });
  }
  return Array.from(headsByReference.values()).sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}

function principalStateMatchesReference(
  reference: PrincipalStateReference,
  state: VerifiedPrincipalPolicy["state"],
): boolean {
  return (
    state.principalType === reference.principalType &&
    state.principalId === reference.principalId &&
    state.version === reference.version &&
    state.keyEpoch === reference.keyEpoch &&
    state.stateHash === reference.stateHash &&
    state.keyFingerprint === reference.keyFingerprint
  );
}

export async function loadPrincipalPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  return loadPrincipalPoliciesForReferences(
    executor,
    collectReferencedPrincipalHeads(paths),
  );
}

export async function loadPrincipalAuthorizationPoliciesForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
  evidence: readonly AnyVerifiedPrincipalPolicy[],
): Promise<AnyVerifiedPrincipalPolicy[]> {
  const missing = references.filter(
    (reference) =>
      !evidence.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
  );
  if (missing.length === 0) return [...evidence];
  try {
    const { policies } =
      await loadVerifiedPrincipalPolicySnapshotsForReferences(
        executor,
        missing,
      );
    return [...evidence, ...policies];
  } catch (error) {
    if (error instanceof PrincipalPolicyError) {
      throw new PrincipalPolicyProjectionError(
        `Principal policy failed integrity verification: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function loadPrincipalAuthorizationPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  evidence: readonly AnyVerifiedPrincipalPolicy[],
): Promise<AnyVerifiedPrincipalPolicy[]> {
  return loadPrincipalAuthorizationPoliciesForReferences(
    executor,
    collectReferencedPrincipalHeads(paths),
    evidence,
  );
}

async function loadPrincipalPoliciesForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
): Promise<VerifiedPrincipalPolicy[]> {
  const referencedPrincipalHeads = dedupeReferencedPrincipalHeads(references);

  if (referencedPrincipalHeads.length === 0) {
    return [];
  }

  const policies: VerifiedPrincipalPolicy[] = [];

  for (const principalType of [
    ...new Set(
      referencedPrincipalHeads.map((reference) => reference.principalType),
    ),
  ]) {
    const referencesForType = referencedPrincipalHeads.filter(
      (reference) => reference.principalType === principalType,
    );
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      referencesForType.map((reference) => reference.principalId),
      executor,
    );

    for (const reference of referencesForType) {
      if (!currentStates.has(reference.principalId)) {
        throw new PrincipalPolicyProjectionError(
          "Principal policy state is stale",
        );
      }
    }

    const resolvedPolicies = await gatherWithExecutor(
      executor,
      Array.from(currentStates.values()),
      async (currentState) => {
        let policy: VerifiedPrincipalPolicy;
        try {
          ({ policy } = await getVerifiedPrincipalPolicyForStateWithExecutor(
            executor,
            currentState,
          ));
        } catch (error) {
          if (error instanceof PrincipalPolicyError) {
            throw new PrincipalPolicyProjectionError(
              `Principal policy failed integrity verification: ${error.message}`,
            );
          }
          throw error;
        }
        const history = policy.history ?? [
          {
            state: policy.state,
            projection: policy.projection,
            grants: policy.grants,
          },
        ];
        const referencesForPrincipal = referencesForType.filter(
          (reference) =>
            principalIdentityKey(reference) ===
            principalIdentityKey(currentState),
        );

        for (const reference of referencesForPrincipal) {
          if (
            !history.some((entry) =>
              principalStateMatchesReference(reference, entry.state),
            )
          ) {
            throw new PrincipalPolicyProjectionError(
              "Principal policy state is stale",
            );
          }
        }

        return policy;
      },
    );

    policies.push(...resolvedPolicies);
  }

  return policies.sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}
