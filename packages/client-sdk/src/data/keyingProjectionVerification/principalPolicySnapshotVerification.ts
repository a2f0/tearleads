import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicySignerPublicKey,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import {
  KeyingVerificationError,
  principalPolicyMatchesReference,
  toFingerprint,
  verifyPrincipalPolicyCheckpoint,
  verifyPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import type { PrincipalPolicySnapshotResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../persistence/principalPolicyReferencePersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import type { ProjectionUserKeyResolver } from "./types";

function identityKey(input: {
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

function snapshotReference(
  snapshot: PrincipalPolicySnapshotResponse,
): ReferencedPrincipalHead {
  const state = snapshot.currentState;
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

async function signerPublicKeys(input: {
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly snapshot: PrincipalPolicySnapshotResponse;
}): Promise<PrincipalPolicySignerPublicKey[]> {
  const keys = new Map<string, PrincipalPolicySignerPublicKey>();
  for (const state of snapshotStates(input.snapshot)) {
    const key = `${state.signerUserId}:${state.signerUserKeyFingerprint}`;
    if (keys.has(key)) {
      continue;
    }
    const identity = await input.resolveUserKey(state.signerUserId);
    if (!identity) {
      throw new Error(
        `Principal policy snapshot signer ${state.signerUserId} is unavailable`,
      );
    }
    const fingerprint = await toFingerprint(identity.signingPublicKey);
    if (fingerprint !== state.signerUserKeyFingerprint) {
      throw new Error("Principal policy snapshot signer fingerprint mismatch");
    }
    keys.set(key, {
      userId: state.signerUserId,
      signingKeyFingerprint: fingerprint,
      signingPublicKey: identity.signingPublicKey,
    });
  }
  return [...keys.values()];
}

function authorityReference(
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
    throw new Error(
      "Principal policy snapshot cites inconsistent external authority",
    );
  }
  return references.reduce((latest, reference) =>
    reference.version > latest.version ? reference : latest,
  );
}

function externalAuthority(
  policy: VerifiedPrincipalPolicySnapshot,
): PrincipalPolicyExternalAuthority {
  const states = policy.history.map((entry) => {
    if (
      entry.state.principalType !== "group" ||
      entry.projection.length === 0 ||
      entry.projection.some((member) => member.role !== "admin")
    ) {
      throw new Error("Principal policy snapshot authority is invalid");
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
  const current = states.at(-1);
  if (!current) {
    throw new Error("Principal policy snapshot authority is empty");
  }
  return { currentHead: current.head, states };
}

async function verifySnapshotAuthorization(input: {
  readonly resolveAuthority: (
    reference: ReferencedPrincipalHead,
  ) => Promise<VerifiedPrincipalPolicySnapshot>;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly snapshot: PrincipalPolicySnapshotResponse;
}): Promise<VerifiedPrincipalPolicySnapshot> {
  const reference = snapshotReference(input.snapshot);
  const direct = await verifyPrincipalPolicySnapshot({
    expectedReference: reference,
    signerPublicKeys: input.signerPublicKeys,
    snapshot: input.snapshot,
  });
  if (direct.ok) {
    return direct.value;
  }
  if (direct.error.code !== "unauthorized") {
    throw direct.error;
  }
  const authorityHead = authorityReference(input.snapshot);
  if (!authorityHead) {
    throw direct.error;
  }
  const authorityPolicy = await input.resolveAuthority(authorityHead);
  if (
    !principalPolicyMatchesReference({
      policy: authorityPolicy,
      reference: authorityHead,
    })
  ) {
    throw new Error(
      "Principal policy snapshot authority omits the referenced head",
    );
  }
  const verified = await verifyPrincipalPolicySnapshot({
    expectedReference: reference,
    externalAuthority: externalAuthority(authorityPolicy),
    signerPublicKeys: input.signerPublicKeys,
    snapshot: input.snapshot,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  return verified.value;
}

async function enforceSnapshotCheckpoint(input: {
  readonly execSql: ExecSql;
  readonly policy: VerifiedPrincipalPolicySnapshot;
  readonly reference: ReferencedPrincipalHead;
}): Promise<boolean> {
  const checkpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    input.reference.principalType,
    input.reference.principalId,
  );
  if (!checkpoint) return true;
  if (input.policy.version >= checkpoint.version) {
    verifyPrincipalPolicyCheckpoint({
      chain: input.policy.history,
      currentState: input.policy.state,
      localCheckpoint: checkpoint,
    });
    return true;
  }
  const localDescendant = await loadPrincipalPolicyBundleForReference(
    input.execSql,
    input.reference,
    checkpoint,
  );
  if (!localDescendant) {
    throw new KeyingVerificationError(
      "rollback",
      "Principal policy snapshot cannot be connected to the newer local checkpoint",
    );
  }
  return false;
}

export async function verifyPrincipalPolicySnapshots(input: {
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly snapshots: readonly PrincipalPolicySnapshotResponse[];
}): Promise<VerifiedPrincipalPolicySnapshot[]> {
  const snapshotsByPrincipal = new Map<
    string,
    PrincipalPolicySnapshotResponse
  >();
  for (const snapshot of input.snapshots) {
    const key = identityKey(snapshot.currentState);
    if (snapshotsByPrincipal.has(key)) {
      throw new Error(
        "Principal policy snapshots contain a duplicate principal",
      );
    }
    snapshotsByPrincipal.set(key, snapshot);
  }
  const verifiedByPrincipal = new Map<
    string,
    VerifiedPrincipalPolicySnapshot
  >();
  const visiting = new Set<string>();

  const verifyOne = async (
    snapshot: PrincipalPolicySnapshotResponse,
  ): Promise<VerifiedPrincipalPolicySnapshot> => {
    const key = identityKey(snapshot.currentState);
    const cached = verifiedByPrincipal.get(key);
    if (cached) {
      return cached;
    }
    if (visiting.has(key)) {
      throw new Error("Principal policy snapshot authority contains a cycle");
    }
    visiting.add(key);
    try {
      const publicKeys = await signerPublicKeys({
        resolveUserKey: input.resolveUserKey,
        snapshot,
      });
      const policy = await verifySnapshotAuthorization({
        resolveAuthority: async (reference) => {
          const authoritySnapshot = snapshotsByPrincipal.get(
            identityKey(reference),
          );
          if (!authoritySnapshot) {
            throw new Error("Principal policy snapshot authority is missing");
          }
          return verifyOne(authoritySnapshot);
        },
        signerPublicKeys: publicKeys,
        snapshot,
      });
      verifiedByPrincipal.set(key, policy);
      return policy;
    } finally {
      visiting.delete(key);
    }
  };

  for (const snapshot of input.snapshots) {
    await verifyOne(snapshot);
  }
  return [...verifiedByPrincipal.values()];
}

export async function enforcePrincipalPolicySnapshotCheckpoints(input: {
  readonly execSql: ExecSql;
  readonly policies: readonly VerifiedPrincipalPolicySnapshot[];
}): Promise<VerifiedPrincipalPolicySnapshot[]> {
  const policiesToPin: VerifiedPrincipalPolicySnapshot[] = [];
  for (const policy of input.policies) {
    const shouldPin = await enforceSnapshotCheckpoint({
      execSql: input.execSql,
      policy,
      reference: {
        principalType: policy.state.principalType,
        principalId: policy.state.principalId,
        version: policy.state.version,
        keyEpoch: policy.state.keyEpoch,
        stateHash: policy.state.stateHash,
        keyFingerprint: policy.state.keyFingerprint,
      },
    });
    if (shouldPin) policiesToPin.push(policy);
  }
  return policiesToPin;
}
