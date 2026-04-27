import {
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  getPrincipalPolicyTransitionMismatchReason,
  type ManagedRecipientPrincipalType,
  normalizePrincipalProjectionMembers,
  type PrincipalProjectionMember,
  type PrincipalProjectionRole,
  type PrincipalStateMemberType,
  type PrincipalStatePayloadCipherSuite,
  type SignedPrincipalState,
  verifySignedPrincipalState,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  principalEpochKeys,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
  users,
} from "../schema";
import { uniqueSortedStrings } from "../utils/array";

type PrincipalStateExecutor = DatabaseExecutor;

export interface StoredPrincipalState extends SignedPrincipalState {
  stateHash: string;
  createdAt: Date;
}

interface StoredPrincipalStatePayload {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  cipherSuite: PrincipalStatePayloadCipherSuite;
  ciphertext: string;
  ciphertextHash: string;
  createdAt: Date;
}

export interface StoredPrincipalProjectionMember {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  role: PrincipalProjectionRole;
  createdAt: Date;
}

interface StoredPrincipalStateChainEntry {
  state: StoredPrincipalState;
  projection: StoredPrincipalProjectionMember[];
}

interface StoredPrincipalEpochKey {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  epoch: number;
  introducedByStateHash: string;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  createdAt: Date;
}

export interface PrincipalStatePayloadInput {
  cipherSuite: PrincipalStatePayloadCipherSuite;
  ciphertext: string;
  ciphertextHash: string;
}

export interface PrincipalStateBundleInput {
  state: SignedPrincipalState;
  encryptedPayload: PrincipalStatePayloadInput;
  projection: PrincipalProjectionMember[];
}

function toStoredPrincipalState(row: {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  version: number;
  prevStateHash: string | null;
  keyEpoch: number;
  encapsulationPublicKey: string;
  keyFingerprint: string;
  membershipMode: "projection_v1";
  membershipRoot: string;
  projectionRoot: string;
  payloadCiphertextHash: string;
  memberCount: number;
  signedAt: Date;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signature: string;
  stateHash: string;
  createdAt: Date;
}): StoredPrincipalState {
  return {
    principalType: row.principalType,
    principalId: row.principalId,
    version: row.version,
    prevStateHash: row.prevStateHash,
    keyEpoch: row.keyEpoch,
    encapsulationPublicKey: row.encapsulationPublicKey,
    keyFingerprint: row.keyFingerprint,
    membershipMode: row.membershipMode,
    membershipRoot: row.membershipRoot,
    projectionRoot: row.projectionRoot,
    payloadCiphertextHash: row.payloadCiphertextHash,
    memberCount: row.memberCount,
    signedAt: row.signedAt.toISOString(),
    signerUserId: row.signerUserId,
    signerUserKeyFingerprint: row.signerUserKeyFingerprint,
    signature: row.signature,
    stateHash: row.stateHash,
    createdAt: row.createdAt,
  };
}

function toStoredProjectionMember(row: {
  principalType: ManagedRecipientPrincipalType;
  principalId: string;
  stateHash: string;
  memberPrincipalType: PrincipalStateMemberType;
  memberPrincipalId: string;
  role: PrincipalProjectionRole;
  createdAt: Date;
}): StoredPrincipalProjectionMember {
  return {
    principalType: row.principalType,
    principalId: row.principalId,
    stateHash: row.stateHash,
    memberPrincipalType: row.memberPrincipalType,
    memberPrincipalId: row.memberPrincipalId,
    role: row.role,
    createdAt: row.createdAt,
  };
}

function stripSignedPrincipalStateArtifacts(
  state: SignedPrincipalState,
): SignedPrincipalState {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    prevStateHash: state.prevStateHash,
    keyEpoch: state.keyEpoch,
    encapsulationPublicKey: state.encapsulationPublicKey,
    keyFingerprint: state.keyFingerprint,
    membershipMode: state.membershipMode,
    membershipRoot: state.membershipRoot,
    projectionRoot: state.projectionRoot,
    payloadCiphertextHash: state.payloadCiphertextHash,
    memberCount: state.memberCount,
    signedAt: state.signedAt,
    signerUserId: state.signerUserId,
    signerUserKeyFingerprint: state.signerUserKeyFingerprint,
    signature: state.signature,
  };
}

function normalizePrincipalStateWriteInput(
  input: PrincipalStateBundleInput,
): PrincipalStateBundleInput {
  return {
    state: stripSignedPrincipalStateArtifacts(input.state),
    encryptedPayload: {
      cipherSuite: input.encryptedPayload.cipherSuite,
      ciphertext: input.encryptedPayload.ciphertext,
      ciphertextHash: input.encryptedPayload.ciphertextHash,
    },
    projection: normalizePrincipalProjectionMembers(input.projection),
  };
}

function projectionMemberKey(
  member: Pick<
    StoredPrincipalProjectionMember | PrincipalProjectionMember,
    "memberPrincipalType" | "memberPrincipalId" | "role"
  >,
): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}:${member.role}`;
}

async function getPrincipalStateByVersion(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  version: number,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalState | null> {
  const [row] = await executor
    .select({
      principalType: principalStates.principalType,
      principalId: principalStates.principalId,
      version: principalStates.version,
      prevStateHash: principalStates.prevStateHash,
      keyEpoch: principalStates.keyEpoch,
      encapsulationPublicKey: principalStates.encapsulationPublicKey,
      keyFingerprint: principalStates.keyFingerprint,
      membershipMode: principalStates.membershipMode,
      membershipRoot: principalStates.membershipRoot,
      projectionRoot: principalStates.projectionRoot,
      payloadCiphertextHash: principalStates.payloadCiphertextHash,
      memberCount: principalStates.memberCount,
      signedAt: principalStates.signedAt,
      signerUserId: principalStates.signerUserId,
      signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
      signature: principalStates.signature,
      stateHash: principalStates.stateHash,
      createdAt: principalStates.createdAt,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
        eq(principalStates.version, version),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return toStoredPrincipalState(row);
}

async function getPrincipalEpochKeyByEpoch(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  epoch: number,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalEpochKey | null> {
  const [row] = await executor
    .select({
      principalType: principalEpochKeys.principalType,
      principalId: principalEpochKeys.principalId,
      epoch: principalEpochKeys.epoch,
      introducedByStateHash: principalEpochKeys.introducedByStateHash,
      encapsulationPublicKey: principalEpochKeys.encapsulationPublicKey,
      keyFingerprint: principalEpochKeys.keyFingerprint,
      createdAt: principalEpochKeys.createdAt,
    })
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        eq(principalEpochKeys.principalId, principalId),
        eq(principalEpochKeys.epoch, epoch),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function getPrincipalStatePayloadForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalStatePayload | null> {
  const [row] = await executor
    .select({
      principalType: principalStatePayloads.principalType,
      principalId: principalStatePayloads.principalId,
      stateHash: principalStatePayloads.stateHash,
      cipherSuite: principalStatePayloads.cipherSuite,
      ciphertext: principalStatePayloads.ciphertext,
      ciphertextHash: principalStatePayloads.ciphertextHash,
      createdAt: principalStatePayloads.createdAt,
    })
    .from(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, principalType),
        eq(principalStatePayloads.principalId, principalId),
        eq(principalStatePayloads.stateHash, stateHash),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function listProjectionMembersForState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  stateHash: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalProjectionMember[]> {
  const rows = await executor
    .select({
      principalType: principalMembershipProjection.principalType,
      principalId: principalMembershipProjection.principalId,
      stateHash: principalMembershipProjection.stateHash,
      memberPrincipalType: principalMembershipProjection.memberPrincipalType,
      memberPrincipalId: principalMembershipProjection.memberPrincipalId,
      role: principalMembershipProjection.role,
      createdAt: principalMembershipProjection.createdAt,
    })
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        eq(principalMembershipProjection.principalId, principalId),
        eq(principalMembershipProjection.stateHash, stateHash),
      ),
    )
    .orderBy(
      principalMembershipProjection.memberPrincipalType,
      principalMembershipProjection.memberPrincipalId,
    );

  return rows.map(toStoredProjectionMember);
}

function principalStateProjectionKey(input: {
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalId}:${input.stateHash}`;
}

export interface PrincipalStateReference {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
  readonly version: number;
  readonly keyEpoch: number;
  readonly stateHash: string;
  readonly keyFingerprint: string;
}

export function principalStateReferenceKey(input: {
  readonly principalType: ManagedRecipientPrincipalType;
  readonly principalId: string;
  readonly stateHash: string;
}): string {
  return `${input.principalType}:${input.principalId}:${input.stateHash}`;
}

export async function getPrincipalStatesForReferences(
  references: readonly PrincipalStateReference[],
  executor: PrincipalStateExecutor = db,
): Promise<Map<string, StoredPrincipalState>> {
  const statesByReference = new Map<string, StoredPrincipalState>();
  const uniqueReferences = new Map(
    references.map((reference) => [
      principalStateReferenceKey(reference),
      reference,
    ]),
  );

  for (const principalType of [
    ...new Set(
      Array.from(uniqueReferences.values()).map(
        (reference) => reference.principalType,
      ),
    ),
  ]) {
    const referencesForType = Array.from(uniqueReferences.values()).filter(
      (reference) => reference.principalType === principalType,
    );
    const principalIds = uniqueSortedStrings(
      referencesForType.map((reference) => reference.principalId),
    );
    const stateHashes = uniqueSortedStrings(
      referencesForType.map((reference) => reference.stateHash),
    );
    const requestedKeys = new Set(
      referencesForType.map(principalStateReferenceKey),
    );

    if (principalIds.length === 0 || stateHashes.length === 0) {
      continue;
    }

    const rows = await executor
      .select({
        principalType: principalStates.principalType,
        principalId: principalStates.principalId,
        version: principalStates.version,
        prevStateHash: principalStates.prevStateHash,
        keyEpoch: principalStates.keyEpoch,
        encapsulationPublicKey: principalStates.encapsulationPublicKey,
        keyFingerprint: principalStates.keyFingerprint,
        membershipMode: principalStates.membershipMode,
        membershipRoot: principalStates.membershipRoot,
        projectionRoot: principalStates.projectionRoot,
        payloadCiphertextHash: principalStates.payloadCiphertextHash,
        memberCount: principalStates.memberCount,
        signedAt: principalStates.signedAt,
        signerUserId: principalStates.signerUserId,
        signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
        signature: principalStates.signature,
        stateHash: principalStates.stateHash,
        createdAt: principalStates.createdAt,
      })
      .from(principalStates)
      .where(
        and(
          eq(principalStates.principalType, principalType),
          inArray(principalStates.principalId, principalIds),
          inArray(principalStates.stateHash, stateHashes),
        ),
      );

    for (const row of rows) {
      const state = toStoredPrincipalState(row);
      const key = principalStateReferenceKey(state);
      if (requestedKeys.has(key)) {
        statesByReference.set(key, state);
      }
    }
  }

  return statesByReference;
}

export async function listPrincipalProjectionMembersForStates(
  principalType: ManagedRecipientPrincipalType,
  states: readonly Pick<StoredPrincipalState, "principalId" | "stateHash">[],
  executor: PrincipalStateExecutor = db,
): Promise<Map<string, StoredPrincipalProjectionMember[]>> {
  const uniquePrincipalIds = uniqueSortedStrings(
    states.map((state) => state.principalId),
  );
  const uniqueStateHashes = uniqueSortedStrings(
    states.map((state) => state.stateHash),
  );
  const requestedKeys = new Set(states.map(principalStateProjectionKey));
  const projectionByState = new Map<
    string,
    StoredPrincipalProjectionMember[]
  >();

  for (const key of requestedKeys) {
    projectionByState.set(key, []);
  }

  if (uniquePrincipalIds.length === 0 || uniqueStateHashes.length === 0) {
    return projectionByState;
  }

  const rows = await executor
    .select({
      principalType: principalMembershipProjection.principalType,
      principalId: principalMembershipProjection.principalId,
      stateHash: principalMembershipProjection.stateHash,
      memberPrincipalType: principalMembershipProjection.memberPrincipalType,
      memberPrincipalId: principalMembershipProjection.memberPrincipalId,
      role: principalMembershipProjection.role,
      createdAt: principalMembershipProjection.createdAt,
    })
    .from(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, principalType),
        inArray(principalMembershipProjection.principalId, uniquePrincipalIds),
        inArray(principalMembershipProjection.stateHash, uniqueStateHashes),
      ),
    )
    .orderBy(
      principalMembershipProjection.principalId,
      principalMembershipProjection.memberPrincipalType,
      principalMembershipProjection.memberPrincipalId,
    );

  for (const row of rows.map(toStoredProjectionMember)) {
    const key = principalStateProjectionKey(row);
    const projection = projectionByState.get(key);

    if (projection) {
      projection.push(row);
    }
  }

  return projectionByState;
}

async function loadPrincipalStateSigner(
  state: SignedPrincipalState,
  executor: PrincipalStateExecutor,
): Promise<{ signingPublicKey: Uint8Array; userId: string }> {
  const [signer] = await executor
    .select({
      id: users.id,
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, state.signerUserId))
    .limit(1);

  if (!signer) {
    throw new Error("Principal state signer user not found");
  }

  if (signer.fingerprint !== state.signerUserKeyFingerprint) {
    throw new Error("Principal state signer fingerprint mismatch");
  }

  return {
    signingPublicKey: base64ToBytes(signer.signingPublicKey),
    userId: signer.id,
  };
}

function projectionIncludesAdminUser(
  projection: ReadonlyArray<
    Pick<
      StoredPrincipalProjectionMember | PrincipalProjectionMember,
      "memberPrincipalType" | "memberPrincipalId" | "role"
    >
  >,
  userId: string,
): boolean {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId &&
      member.role === "admin",
  );
}

async function validatePrincipalStateChain(
  state: SignedPrincipalState,
  stateHash: string,
  executor: PrincipalStateExecutor,
): Promise<StoredPrincipalState | null> {
  const currentState = await getCurrentPrincipalState(
    state.principalType,
    state.principalId,
    executor,
  );

  if (!currentState) {
    if (state.prevStateHash !== null || state.version !== 1) {
      throw new Error("Principal state previous hash mismatch");
    }
    return null;
  }

  if (state.version === currentState.version) {
    if (stateHash !== currentState.stateHash) {
      throw new Error("Principal state version conflict");
    }
    return currentState;
  }

  if (
    state.version !== currentState.version + 1 ||
    state.prevStateHash !== currentState.stateHash
  ) {
    throw new Error("Principal state previous hash mismatch");
  }

  return currentState;
}

async function validatePrincipalStateSignerAuthorization(input: {
  currentState: StoredPrincipalState | null;
  normalizedInput: PrincipalStateBundleInput;
  signerUserId: string;
  executor: PrincipalStateExecutor;
}): Promise<StoredPrincipalProjectionMember[] | null> {
  if (!input.currentState) {
    if (
      !projectionIncludesAdminUser(
        input.normalizedInput.projection,
        input.signerUserId,
      )
    ) {
      throw new Error("Principal state signer must be an admin");
    }
    return null;
  }

  const previousProjection = await listProjectionMembersForState(
    input.currentState.principalType,
    input.currentState.principalId,
    input.currentState.stateHash,
    input.executor,
  );

  if (!projectionIncludesAdminUser(previousProjection, input.signerUserId)) {
    throw new Error("Principal state signer must be an admin");
  }

  return previousProjection;
}

function validatePrincipalPolicyTransition(input: {
  currentState: SignedPrincipalState;
  currentProjection: readonly PrincipalProjectionMember[];
  previousProjection: readonly StoredPrincipalProjectionMember[] | null;
  previousState: StoredPrincipalState | null;
}): void {
  if (!input.previousState || !input.previousProjection) {
    return;
  }

  const mismatchReason = getPrincipalPolicyTransitionMismatchReason({
    current: {
      state: input.currentState,
      projection: input.currentProjection,
    },
    previous: {
      state: input.previousState,
      projection: input.previousProjection,
    },
  });

  if (mismatchReason) {
    throw new Error(mismatchReason);
  }
}

async function validatePrincipalStateArtifacts(
  input: PrincipalStateBundleInput,
): Promise<void> {
  const computedProjectionRoot = await computePrincipalProjectionRoot(
    input.projection,
  );
  if (computedProjectionRoot !== input.state.projectionRoot) {
    throw new Error("Principal state projectionRoot does not match projection");
  }

  const computedPayloadCiphertextHash =
    await computePrincipalStatePayloadCiphertextHash(
      input.encryptedPayload.ciphertext,
    );
  if (computedPayloadCiphertextHash !== input.encryptedPayload.ciphertextHash) {
    throw new Error(
      "Principal state payload ciphertext hash does not match ciphertext",
    );
  }

  if (computedPayloadCiphertextHash !== input.state.payloadCiphertextHash) {
    throw new Error(
      "Principal state payloadCiphertextHash does not match encrypted payload",
    );
  }

  if (input.projection.length !== input.state.memberCount) {
    throw new Error("Principal state memberCount does not match projection");
  }
}

async function insertPrincipalStateRow(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  signedAt: Date;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  await input.executor
    .insert(principalStates)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      version: input.normalizedInput.state.version,
      prevStateHash: input.normalizedInput.state.prevStateHash,
      keyEpoch: input.normalizedInput.state.keyEpoch,
      encapsulationPublicKey:
        input.normalizedInput.state.encapsulationPublicKey,
      keyFingerprint: input.normalizedInput.state.keyFingerprint,
      membershipMode: input.normalizedInput.state.membershipMode,
      membershipRoot: input.normalizedInput.state.membershipRoot,
      projectionRoot: input.normalizedInput.state.projectionRoot,
      payloadCiphertextHash: input.normalizedInput.state.payloadCiphertextHash,
      memberCount: input.normalizedInput.state.memberCount,
      stateHash: input.stateHash,
      signedAt: input.signedAt,
      signerUserId: input.normalizedInput.state.signerUserId,
      signerUserKeyFingerprint:
        input.normalizedInput.state.signerUserKeyFingerprint,
      signature: input.normalizedInput.state.signature,
    })
    .onConflictDoNothing({
      target: [
        principalStates.principalType,
        principalStates.principalId,
        principalStates.version,
      ],
    });
}

async function ensureStoredPrincipalStateMatches(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<StoredPrincipalState> {
  const storedState = await getPrincipalStateByVersion(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.normalizedInput.state.version,
    input.executor,
  );

  if (!storedState) {
    throw new Error("Failed to load stored principal state");
  }

  if (storedState.stateHash !== input.stateHash) {
    throw new Error("Principal state version conflict");
  }

  return storedState;
}

async function insertPrincipalStatePayloadRow(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  await input.executor
    .insert(principalStatePayloads)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      stateHash: input.stateHash,
      cipherSuite: input.normalizedInput.encryptedPayload.cipherSuite,
      ciphertext: input.normalizedInput.encryptedPayload.ciphertext,
      ciphertextHash: input.normalizedInput.encryptedPayload.ciphertextHash,
    })
    .onConflictDoNothing({
      target: [
        principalStatePayloads.principalType,
        principalStatePayloads.principalId,
        principalStatePayloads.stateHash,
      ],
    });
}

async function ensureStoredPrincipalPayloadMatches(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  const storedPayload = await getPrincipalStatePayloadForState(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.stateHash,
    input.executor,
  );
  if (!storedPayload) {
    throw new Error("Failed to load stored principal state payload");
  }
  if (
    storedPayload.cipherSuite !==
      input.normalizedInput.encryptedPayload.cipherSuite ||
    storedPayload.ciphertext !==
      input.normalizedInput.encryptedPayload.ciphertext ||
    storedPayload.ciphertextHash !==
      input.normalizedInput.encryptedPayload.ciphertextHash
  ) {
    throw new Error("Principal state payload conflict");
  }
}

async function insertPrincipalProjectionRows(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  if (input.normalizedInput.projection.length === 0) {
    return;
  }

  await input.executor
    .insert(principalMembershipProjection)
    .values(
      input.normalizedInput.projection.map((member) => ({
        principalType: input.normalizedInput.state.principalType,
        principalId: input.normalizedInput.state.principalId,
        stateHash: input.stateHash,
        memberPrincipalType: member.memberPrincipalType,
        memberPrincipalId: member.memberPrincipalId,
        role: member.role,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalMembershipProjection.principalType,
        principalMembershipProjection.principalId,
        principalMembershipProjection.stateHash,
        principalMembershipProjection.memberPrincipalType,
        principalMembershipProjection.memberPrincipalId,
      ],
    });
}

async function ensureStoredPrincipalProjectionMatches(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  const storedProjection = await listProjectionMembersForState(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.stateHash,
    input.executor,
  );

  if (storedProjection.length !== input.normalizedInput.projection.length) {
    throw new Error("Principal state projection conflict");
  }

  const storedProjectionKeys = new Set(
    storedProjection.map((member) => projectionMemberKey(member)),
  );
  for (const member of input.normalizedInput.projection) {
    if (!storedProjectionKeys.has(projectionMemberKey(member))) {
      throw new Error("Principal state projection conflict");
    }
  }
}

async function insertPrincipalEpochKeyRow(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  await input.executor
    .insert(principalEpochKeys)
    .values({
      principalType: input.normalizedInput.state.principalType,
      principalId: input.normalizedInput.state.principalId,
      epoch: input.normalizedInput.state.keyEpoch,
      introducedByStateHash: input.stateHash,
      encapsulationPublicKey:
        input.normalizedInput.state.encapsulationPublicKey,
      keyFingerprint: input.normalizedInput.state.keyFingerprint,
    })
    .onConflictDoNothing({
      target: [
        principalEpochKeys.principalType,
        principalEpochKeys.principalId,
        principalEpochKeys.epoch,
      ],
    });
}

async function ensureStoredPrincipalEpochKeyMatches(input: {
  normalizedInput: PrincipalStateBundleInput;
  stateHash: string;
  executor: PrincipalStateExecutor;
}): Promise<void> {
  const storedEpochKey = await getPrincipalEpochKeyByEpoch(
    input.normalizedInput.state.principalType,
    input.normalizedInput.state.principalId,
    input.normalizedInput.state.keyEpoch,
    input.executor,
  );

  if (!storedEpochKey) {
    throw new Error("Failed to load stored principal epoch key");
  }

  if (
    storedEpochKey.encapsulationPublicKey !==
      input.normalizedInput.state.encapsulationPublicKey ||
    storedEpochKey.keyFingerprint !== input.normalizedInput.state.keyFingerprint
  ) {
    throw new Error("Principal epoch key conflict");
  }
}

export async function storeVerifiedPrincipalState(
  input: PrincipalStateBundleInput,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalState> {
  if (executor === db) {
    return db.transaction(async (tx) => storeVerifiedPrincipalState(input, tx));
  }

  const normalizedInput = normalizePrincipalStateWriteInput(input);
  const signer = await loadPrincipalStateSigner(
    normalizedInput.state,
    executor,
  );

  if (
    !(await verifySignedPrincipalState(
      normalizedInput.state,
      signer.signingPublicKey,
    ))
  ) {
    throw new Error("Invalid principal state signature");
  }

  await validatePrincipalStateArtifacts(normalizedInput);

  const stateHash = await computePrincipalStateHash(normalizedInput.state);
  const currentState = await validatePrincipalStateChain(
    normalizedInput.state,
    stateHash,
    executor,
  );
  const previousProjection = await validatePrincipalStateSignerAuthorization({
    currentState,
    normalizedInput,
    signerUserId: signer.userId,
    executor,
  });
  if (currentState && normalizedInput.state.version > currentState.version) {
    validatePrincipalPolicyTransition({
      currentState: normalizedInput.state,
      currentProjection: normalizedInput.projection,
      previousProjection,
      previousState: currentState,
    });
  }
  const signedAt = new Date(normalizedInput.state.signedAt);

  await insertPrincipalStateRow({
    normalizedInput,
    stateHash,
    signedAt,
    executor,
  });
  const storedState = await ensureStoredPrincipalStateMatches({
    normalizedInput,
    stateHash,
    executor,
  });
  await insertPrincipalStatePayloadRow({
    normalizedInput,
    stateHash,
    executor,
  });
  await ensureStoredPrincipalPayloadMatches({
    normalizedInput,
    stateHash,
    executor,
  });
  await insertPrincipalProjectionRows({
    normalizedInput,
    stateHash,
    executor,
  });
  await ensureStoredPrincipalProjectionMatches({
    normalizedInput,
    stateHash,
    executor,
  });
  await insertPrincipalEpochKeyRow({
    normalizedInput,
    stateHash,
    executor,
  });
  await ensureStoredPrincipalEpochKeyMatches({
    normalizedInput,
    stateHash,
    executor,
  });

  return storedState;
}

export async function getCurrentPrincipalState(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalState | null> {
  const [row] = await executor
    .select({
      principalType: principalStates.principalType,
      principalId: principalStates.principalId,
      version: principalStates.version,
      prevStateHash: principalStates.prevStateHash,
      keyEpoch: principalStates.keyEpoch,
      encapsulationPublicKey: principalStates.encapsulationPublicKey,
      keyFingerprint: principalStates.keyFingerprint,
      membershipMode: principalStates.membershipMode,
      membershipRoot: principalStates.membershipRoot,
      projectionRoot: principalStates.projectionRoot,
      payloadCiphertextHash: principalStates.payloadCiphertextHash,
      memberCount: principalStates.memberCount,
      signedAt: principalStates.signedAt,
      signerUserId: principalStates.signerUserId,
      signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
      signature: principalStates.signature,
      stateHash: principalStates.stateHash,
      createdAt: principalStates.createdAt,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);

  if (!row) {
    return null;
  }

  return toStoredPrincipalState(row);
}

export async function getCurrentPrincipalStates(
  principalType: ManagedRecipientPrincipalType,
  principalIds: string[],
  executor: PrincipalStateExecutor = db,
): Promise<Map<string, StoredPrincipalState>> {
  const uniquePrincipalIds = uniqueSortedStrings(principalIds);

  if (uniquePrincipalIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      principalType: principalStates.principalType,
      principalId: principalStates.principalId,
      version: principalStates.version,
      prevStateHash: principalStates.prevStateHash,
      keyEpoch: principalStates.keyEpoch,
      encapsulationPublicKey: principalStates.encapsulationPublicKey,
      keyFingerprint: principalStates.keyFingerprint,
      membershipMode: principalStates.membershipMode,
      membershipRoot: principalStates.membershipRoot,
      projectionRoot: principalStates.projectionRoot,
      payloadCiphertextHash: principalStates.payloadCiphertextHash,
      memberCount: principalStates.memberCount,
      signedAt: principalStates.signedAt,
      signerUserId: principalStates.signerUserId,
      signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
      signature: principalStates.signature,
      stateHash: principalStates.stateHash,
      createdAt: principalStates.createdAt,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        inArray(principalStates.principalId, uniquePrincipalIds),
      ),
    )
    .orderBy(asc(principalStates.principalId), desc(principalStates.version));

  const currentStatesByPrincipalId = new Map<string, StoredPrincipalState>();

  for (const row of rows) {
    if (currentStatesByPrincipalId.has(row.principalId)) {
      continue;
    }

    currentStatesByPrincipalId.set(
      row.principalId,
      toStoredPrincipalState(row),
    );
  }

  return currentStatesByPrincipalId;
}

export async function listPrincipalStateHistory(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalStateChainEntry[]> {
  const rows = await executor
    .select({
      principalType: principalStates.principalType,
      principalId: principalStates.principalId,
      version: principalStates.version,
      prevStateHash: principalStates.prevStateHash,
      keyEpoch: principalStates.keyEpoch,
      encapsulationPublicKey: principalStates.encapsulationPublicKey,
      keyFingerprint: principalStates.keyFingerprint,
      membershipMode: principalStates.membershipMode,
      membershipRoot: principalStates.membershipRoot,
      projectionRoot: principalStates.projectionRoot,
      payloadCiphertextHash: principalStates.payloadCiphertextHash,
      memberCount: principalStates.memberCount,
      signedAt: principalStates.signedAt,
      signerUserId: principalStates.signerUserId,
      signerUserKeyFingerprint: principalStates.signerUserKeyFingerprint,
      signature: principalStates.signature,
      stateHash: principalStates.stateHash,
      createdAt: principalStates.createdAt,
    })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, principalType),
        eq(principalStates.principalId, principalId),
      ),
    )
    .orderBy(asc(principalStates.version));

  const history: StoredPrincipalStateChainEntry[] = [];

  for (const row of rows) {
    const state = toStoredPrincipalState(row);
    history.push({
      state,
      projection: await listProjectionMembersForState(
        principalType,
        principalId,
        state.stateHash,
        executor,
      ),
    });
  }

  return history;
}

export async function getCurrentPrincipalStatePayload(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalStatePayload | null> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    return null;
  }

  return getPrincipalStatePayloadForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
}

export async function listCurrentPrincipalProjectionMembers(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalProjectionMember[]> {
  const currentState = await getCurrentPrincipalState(
    principalType,
    principalId,
    executor,
  );

  if (!currentState) {
    return [];
  }

  return listProjectionMembersForState(
    principalType,
    principalId,
    currentState.stateHash,
    executor,
  );
}

export async function getCurrentPrincipalEpochKey(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalEpochKey | null> {
  const [row] = await executor
    .select({
      principalType: principalEpochKeys.principalType,
      principalId: principalEpochKeys.principalId,
      epoch: principalEpochKeys.epoch,
      introducedByStateHash: principalEpochKeys.introducedByStateHash,
      encapsulationPublicKey: principalEpochKeys.encapsulationPublicKey,
      keyFingerprint: principalEpochKeys.keyFingerprint,
      createdAt: principalEpochKeys.createdAt,
    })
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        eq(principalEpochKeys.principalId, principalId),
      ),
    )
    .orderBy(desc(principalEpochKeys.epoch))
    .limit(1);

  return row ?? null;
}

export async function getCurrentPrincipalEpochKeys(
  principalType: ManagedRecipientPrincipalType,
  principalIds: string[],
  executor: PrincipalStateExecutor = db,
): Promise<Map<string, StoredPrincipalEpochKey>> {
  const uniquePrincipalIds = uniqueSortedStrings(principalIds);

  if (uniquePrincipalIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      principalType: principalEpochKeys.principalType,
      principalId: principalEpochKeys.principalId,
      epoch: principalEpochKeys.epoch,
      introducedByStateHash: principalEpochKeys.introducedByStateHash,
      encapsulationPublicKey: principalEpochKeys.encapsulationPublicKey,
      keyFingerprint: principalEpochKeys.keyFingerprint,
      createdAt: principalEpochKeys.createdAt,
    })
    .from(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, principalType),
        inArray(principalEpochKeys.principalId, uniquePrincipalIds),
      ),
    )
    .orderBy(
      asc(principalEpochKeys.principalId),
      desc(principalEpochKeys.epoch),
    );

  const currentEpochKeysByPrincipalId = new Map<
    string,
    StoredPrincipalEpochKey
  >();

  for (const row of rows) {
    if (currentEpochKeysByPrincipalId.has(row.principalId)) {
      continue;
    }

    currentEpochKeysByPrincipalId.set(row.principalId, row);
  }

  return currentEpochKeysByPrincipalId;
}
