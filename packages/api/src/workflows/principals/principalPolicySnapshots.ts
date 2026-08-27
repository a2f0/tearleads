import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type {
  PrincipalPolicyExternalAuthority,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicySnapshot,
} from "@symcrypt/crypto";
import {
  principalPolicyMatchesReference,
  verifyPrincipalPolicySnapshot,
} from "@symcrypt/crypto";
import type { PrincipalPolicySnapshotResponse } from "@symcrypt/validators/response";
import {
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { buildPrincipalPolicySnapshotForStateWithExecutor } from "./principalPolicyBundleRecords";
import { PrincipalPolicyError } from "./shared";
import { loadPolicySignerPublicKeys } from "./storedPrincipalPolicySource";

interface VerifiedSnapshot {
  readonly policy: VerifiedPrincipalPolicySnapshot;
  readonly snapshot: PrincipalPolicySnapshotResponse;
}

function upsertVerifiedSnapshot(
  snapshots: VerifiedSnapshot[],
  candidate: VerifiedSnapshot,
): void {
  const key = principalIdentityKey(candidate.policy);
  const index = snapshots.findIndex(
    ({ policy }) => principalIdentityKey(policy) === key,
  );
  if (index === -1) {
    snapshots.push(candidate);
    return;
  }
  const current = snapshots[index];
  if (!current) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshot index is invalid",
      409,
    );
  }
  if (
    current.snapshot.currentState.version ===
      candidate.snapshot.currentState.version &&
    current.snapshot.currentState.stateHash !==
      candidate.snapshot.currentState.stateHash
  ) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshots equivocate at one version",
      409,
    );
  }
  if (
    candidate.snapshot.currentState.version >
    current.snapshot.currentState.version
  ) {
    snapshots[index] = candidate;
  }
}

function principalIdentityKey(input: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${input.principalType}:${input.principalId}`;
}

function snapshotStates(snapshot: PrincipalPolicySnapshotResponse) {
  return [
    ...snapshot.previousStates.map((entry) => entry.state),
    snapshot.currentState,
  ];
}

function externalAuthorityReference(
  snapshot: PrincipalPolicySnapshotResponse,
): ReferencedPrincipalHead | null {
  const references = snapshotStates(snapshot).flatMap((state) =>
    state.externalAuthority ? [state.externalAuthority] : [],
  );
  if (references.length === 0) {
    return null;
  }
  const [first] = references;
  if (
    !first ||
    references.some(
      (reference) =>
        reference.principalId !== first.principalId ||
        reference.principalType !== first.principalType,
    )
  ) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshot cites inconsistent external authority",
      409,
    );
  }
  return references.reduce((latest, reference) =>
    reference.version > latest.version ? reference : latest,
  );
}

function externalAuthorityFromPolicy(
  policy: VerifiedPrincipalPolicySnapshot,
): PrincipalPolicyExternalAuthority {
  const states = policy.history.map((entry) => {
    if (entry.state.principalType !== "group") {
      throw new PrincipalPolicyError(
        "Stored principal policy snapshot authority is not a group",
        409,
      );
    }
    return {
      head: {
        principalType: "group" as const,
        principalId: entry.state.principalId,
        version: entry.state.version,
        keyEpoch: entry.state.keyEpoch,
        stateHash: entry.state.stateHash,
        keyFingerprint: entry.state.keyFingerprint,
      },
      projection: entry.projection,
    };
  });
  if (
    states.some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  ) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshot authority has an invalid projection",
      409,
    );
  }
  const current = states.at(-1);
  if (!current) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshot authority is empty",
      409,
    );
  }
  return { currentHead: current.head, states };
}

async function loadExactState(
  executor: DatabaseSession,
  reference: ReferencedPrincipalHead,
): Promise<StoredPrincipalState> {
  const states = await getPrincipalStatesForReferences([reference], executor);
  const state = states.get(principalStateReferenceKey(reference));
  if (!state) {
    throw new PrincipalPolicyError(
      "Stored principal policy snapshot state is missing",
      409,
    );
  }
  return state;
}

async function verifySnapshot(input: {
  readonly executor: DatabaseSession;
  readonly reference: ReferencedPrincipalHead;
  readonly snapshot: PrincipalPolicySnapshotResponse;
}): Promise<{
  readonly authority?: VerifiedSnapshot | undefined;
  readonly policy: VerifiedPrincipalPolicySnapshot;
}> {
  const signerPublicKeys = await loadPolicySignerPublicKeys(
    input.executor,
    input.snapshot,
  );
  const direct = await verifyPrincipalPolicySnapshot({
    expectedReference: input.reference,
    signerPublicKeys,
    snapshot: input.snapshot,
  });
  if (direct.ok) {
    return { policy: direct.value };
  }
  if (direct.error.code !== "unauthorized") {
    throw new PrincipalPolicyError(direct.error.message, 409);
  }
  const authorityReference = externalAuthorityReference(input.snapshot);
  if (!authorityReference) {
    throw new PrincipalPolicyError(direct.error.message, 409);
  }
  const authorityState = await loadExactState(
    input.executor,
    authorityReference,
  );
  const authoritySnapshot =
    await buildPrincipalPolicySnapshotForStateWithExecutor(
      input.executor,
      authorityState,
    );
  const authority = await verifyPrincipalPolicySnapshot({
    expectedReference: authorityReference,
    signerPublicKeys: await loadPolicySignerPublicKeys(
      input.executor,
      authoritySnapshot,
    ),
    snapshot: authoritySnapshot,
  });
  if (!authority.ok) {
    throw new PrincipalPolicyError(authority.error.message, 409);
  }
  const verified = await verifyPrincipalPolicySnapshot({
    expectedReference: input.reference,
    externalAuthority: externalAuthorityFromPolicy(authority.value),
    signerPublicKeys,
    snapshot: input.snapshot,
  });
  if (!verified.ok) {
    throw new PrincipalPolicyError(verified.error.message, 409);
  }
  return {
    authority: { policy: authority.value, snapshot: authoritySnapshot },
    policy: verified.value,
  };
}

export async function loadVerifiedPrincipalPolicySnapshotsForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
): Promise<{
  readonly policies: VerifiedPrincipalPolicySnapshot[];
  readonly snapshots: PrincipalPolicySnapshotResponse[];
}> {
  const latestByPrincipal = new Map<string, ReferencedPrincipalHead>();
  for (const reference of references) {
    const key = principalIdentityKey(reference);
    const current = latestByPrincipal.get(key);
    if (!current || reference.version > current.version) {
      latestByPrincipal.set(key, reference);
    }
  }

  const verifiedSnapshots: VerifiedSnapshot[] = [];
  for (const reference of latestByPrincipal.values()) {
    const snapshot = await buildPrincipalPolicySnapshotForStateWithExecutor(
      executor,
      await loadExactState(executor, reference),
    );
    const verified = await verifySnapshot({ executor, reference, snapshot });
    const authority = verified.authority;
    if (authority) {
      upsertVerifiedSnapshot(verifiedSnapshots, authority);
    }
    upsertVerifiedSnapshot(verifiedSnapshots, {
      policy: verified.policy,
      snapshot,
    });
  }

  for (const reference of references) {
    if (
      !verifiedSnapshots.some(({ policy }) =>
        principalPolicyMatchesReference({ policy, reference }),
      )
    ) {
      throw new PrincipalPolicyError(
        "Stored principal policy snapshot omits a referenced state",
        409,
      );
    }
  }
  return {
    policies: verifiedSnapshots.map(({ policy }) => policy),
    snapshots: verifiedSnapshots.map(({ snapshot }) => snapshot),
  };
}
