import type {
  PrincipalPolicySignedState,
  PrincipalProjectionMember,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { computePrincipalProjectionRoot } from "@tearleads/crypto";
import {
  getPrincipalStatesForReferences,
  listPrincipalProjectionMembersForStates,
  type PrincipalStateReference,
  principalStateReferenceKey,
  type StoredPrincipalProjectionMember,
  type StoredPrincipalState,
} from "../access/read/principalStateStore";
import type { DatabaseSession } from "../adapters/postgres";

export class PrincipalPolicyProjectionError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "PrincipalPolicyProjectionError";
  }
}

function projectionStateKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
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
  readonly projection: readonly StoredPrincipalProjectionMember[];
  readonly state: StoredPrincipalState;
}): Promise<VerifiedPrincipalPolicy> {
  const projection = input.projection.map(projectionMemberFromStored);

  await assertStoredProjectionMatchesState({
    projection,
    state: input.state,
  });

  return {
    principalType: input.state.principalType,
    principalId: input.state.principalId,
    version: input.state.version,
    keyEpoch: input.state.keyEpoch,
    stateHash: input.state.stateHash,
    state: input.state as PrincipalPolicySignedState,
    projection,
    checkpoint: {
      principalType: input.state.principalType,
      principalId: input.state.principalId,
      version: input.state.version,
      stateHash: input.state.stateHash,
    },
  } as VerifiedPrincipalPolicy;
}

export async function loadPrincipalPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const referencedPrincipalHeads = collectReferencedPrincipalHeads(paths);

  if (referencedPrincipalHeads.length === 0) {
    return [];
  }

  const statesByReference = await getPrincipalStatesForReferences(
    referencedPrincipalHeads,
    executor,
  );
  const policies: VerifiedPrincipalPolicy[] = [];

  for (const principalType of [
    ...new Set(
      referencedPrincipalHeads.map((reference) => reference.principalType),
    ),
  ]) {
    const referencesForType = referencedPrincipalHeads.filter(
      (reference) => reference.principalType === principalType,
    );
    const states = referencesForType.map((reference) => {
      const state = statesByReference.get(
        principalStateReferenceKey(reference),
      );
      assertStoredPrincipalStateMatchesReference(reference, state);
      return state;
    });
    const projectionsByState = await listPrincipalProjectionMembersForStates(
      principalType,
      states,
      executor,
    );

    for (const state of states) {
      policies.push(
        await principalPolicyFromStored({
          projection: projectionsByState.get(projectionStateKey(state)) ?? [],
          state,
        }),
      );
    }
  }

  return policies.sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}
