import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computePrincipalProjectionRoot,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  listPrincipalStateHistory,
  type PrincipalStateReference,
  principalStateReferenceKey,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";

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

function projectionMemberFromStored(
  member: StoredPrincipalProjectionMember,
): PrincipalProjectionMember {
  return {
    memberPrincipalType: member.memberPrincipalType,
    memberPrincipalId: member.memberPrincipalId,
    role: member.role,
  };
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

function assertStoredPrincipalStateMatchesReference(
  reference: PrincipalStateReference,
  state: StoredPrincipalState | undefined,
): asserts state is StoredPrincipalState {
  if (
    !state ||
    state.principalType !== reference.principalType ||
    state.principalId !== reference.principalId ||
    state.version !== reference.version ||
    state.keyEpoch !== reference.keyEpoch ||
    state.stateHash !== reference.stateHash ||
    state.keyFingerprint !== reference.keyFingerprint
  ) {
    throw new PrincipalPolicyProjectionError("Principal policy state is stale");
  }
}

function principalStateMatchesReference(
  reference: PrincipalStateReference,
  state: StoredPrincipalState,
): boolean {
  try {
    assertStoredPrincipalStateMatchesReference(reference, state);
    return true;
  } catch {
    return false;
  }
}

async function assertStoredProjectionMatchesState(input: {
  readonly projection: readonly PrincipalProjectionMember[];
  readonly state: StoredPrincipalState;
}): Promise<void> {
  const projectionRoot = await computePrincipalProjectionRoot(input.projection);
  if (
    projectionRoot !== input.state.projectionRoot ||
    input.projection.length !== input.state.memberCount
  ) {
    throw new PrincipalPolicyProjectionError(
      "Principal policy projection is stale",
    );
  }
}

async function principalPolicyFromStored(input: {
  readonly history: Awaited<ReturnType<typeof listPrincipalStateHistory>>;
}): Promise<VerifiedPrincipalPolicy> {
  const history = await Promise.all(
    input.history.map(async (entry) => {
      const projection = entry.projection.map(projectionMemberFromStored);

      await assertStoredProjectionMatchesState({
        projection,
        state: entry.state,
      });

      return {
        state: entry.state,
        projection,
      };
    }),
  );
  const currentEntry = history.at(-1);

  if (!currentEntry) {
    throw new PrincipalPolicyProjectionError("Principal policy state is stale");
  }

  return makeVerifiedPrincipalPolicy({
    principalType: currentEntry.state.principalType,
    principalId: currentEntry.state.principalId,
    version: currentEntry.state.version,
    keyEpoch: currentEntry.state.keyEpoch,
    stateHash: currentEntry.state.stateHash,
    state: currentEntry.state,
    projection: currentEntry.projection,
    history,
    checkpoint: {
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      stateHash: currentEntry.state.stateHash,
    },
  });
}

export async function loadPrincipalPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const referencedPrincipalHeads = collectReferencedPrincipalHeads(paths);

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
        const history = await listPrincipalStateHistory(
          currentState.principalType,
          currentState.principalId,
          executor,
        );
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

        return principalPolicyFromStored({
          history,
        });
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

/**
 * Loads ONE verified principal policy for a pinned historical head,
 * fail-soft: null when the principal no longer exists, the head is not in
 * its verified stored history, or the stored chain cannot be re-verified.
 * Historical-audience filtering uses this so one unresolvable principal
 * cannot discard proofs carried by others pinned alongside it.
 */
export async function loadPrincipalPolicyForReferencedHead(
  executor: DatabaseSession,
  principalHead: ReferencedPrincipalHead,
): Promise<VerifiedPrincipalPolicy | null> {
  const currentStates = await getCurrentPrincipalStates(
    principalHead.principalType,
    [principalHead.principalId],
    executor,
  );
  if (!currentStates.has(principalHead.principalId)) {
    return null;
  }
  const history = await listPrincipalStateHistory(
    principalHead.principalType,
    principalHead.principalId,
    executor,
  );
  if (
    !history.some((entry) =>
      principalStateMatchesReference(principalHead, entry.state),
    )
  ) {
    return null;
  }
  try {
    return await principalPolicyFromStored({ history });
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      return null;
    }
    throw error;
  }
}
