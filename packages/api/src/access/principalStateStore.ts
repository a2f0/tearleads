import {
  computePrincipalStateHash,
  isPrincipalStateMemberType,
  type ManagedRecipientPrincipalType,
  normalizePrincipalStateMembers,
  type PrincipalStateMember,
  type SignedPrincipalState,
  verifySignedPrincipalState,
} from "@tearleads/crypto";
import { and, desc, eq } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { principalEpochKeys, principalStates } from "../schema";

type PrincipalStateExecutor = DatabaseExecutor;

interface StoredPrincipalState extends SignedPrincipalState {
  stateHash: string;
  createdAt: Date;
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

function isPrincipalStateMember(value: unknown): value is PrincipalStateMember {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const principalType = Reflect.get(value, "principalType");
  const principalId = Reflect.get(value, "principalId");

  return (
    typeof principalType === "string" &&
    isPrincipalStateMemberType(principalType) &&
    typeof principalId === "string" &&
    principalId.length > 0
  );
}

function parsePrincipalStateMembers(value: string): PrincipalStateMember[] {
  const parsedValue: unknown = JSON.parse(value);

  if (
    !Array.isArray(parsedValue) ||
    !parsedValue.every(isPrincipalStateMember)
  ) {
    throw new Error("Stored principal state members are invalid");
  }

  return normalizePrincipalStateMembers(parsedValue);
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
      membersJson: principalStates.membersJson,
      membershipRoot: principalStates.membershipRoot,
      signedAt: principalStates.signedAt,
      signerKeyId: principalStates.signerKeyId,
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

  return {
    principalType: row.principalType,
    principalId: row.principalId,
    version: row.version,
    prevStateHash: row.prevStateHash,
    keyEpoch: row.keyEpoch,
    encapsulationPublicKey: row.encapsulationPublicKey,
    keyFingerprint: row.keyFingerprint,
    members: parsePrincipalStateMembers(row.membersJson),
    membershipRoot: row.membershipRoot,
    signedAt: row.signedAt.toISOString(),
    signerKeyId: row.signerKeyId,
    signature: row.signature,
    stateHash: row.stateHash,
    createdAt: row.createdAt,
  };
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

export async function storeVerifiedPrincipalState(
  state: SignedPrincipalState,
  signerPublicKey: Uint8Array,
  executor: PrincipalStateExecutor = db,
): Promise<StoredPrincipalState> {
  if (executor === db) {
    return db.transaction(async (tx) =>
      storeVerifiedPrincipalState(state, signerPublicKey, tx),
    );
  }

  if (!(await verifySignedPrincipalState(state, signerPublicKey))) {
    throw new Error("Invalid principal state signature");
  }

  const stateHash = await computePrincipalStateHash(state);
  const signedAt = new Date(state.signedAt);

  await executor
    .insert(principalStates)
    .values({
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      prevStateHash: state.prevStateHash,
      keyEpoch: state.keyEpoch,
      encapsulationPublicKey: state.encapsulationPublicKey,
      keyFingerprint: state.keyFingerprint,
      membersJson: JSON.stringify(
        normalizePrincipalStateMembers(state.members),
      ),
      membershipRoot: state.membershipRoot,
      stateHash,
      signedAt,
      signerKeyId: state.signerKeyId,
      signature: state.signature,
    })
    .onConflictDoNothing({
      target: [
        principalStates.principalType,
        principalStates.principalId,
        principalStates.version,
      ],
    });

  const storedState = await getPrincipalStateByVersion(
    state.principalType,
    state.principalId,
    state.version,
    executor,
  );

  if (!storedState) {
    throw new Error("Failed to load stored principal state");
  }

  if (storedState.stateHash !== stateHash) {
    throw new Error("Principal state version conflict");
  }

  await executor
    .insert(principalEpochKeys)
    .values({
      principalType: state.principalType,
      principalId: state.principalId,
      epoch: state.keyEpoch,
      introducedByStateHash: stateHash,
      encapsulationPublicKey: state.encapsulationPublicKey,
      keyFingerprint: state.keyFingerprint,
    })
    .onConflictDoNothing({
      target: [
        principalEpochKeys.principalType,
        principalEpochKeys.principalId,
        principalEpochKeys.epoch,
      ],
    });

  const storedEpochKey = await getPrincipalEpochKeyByEpoch(
    state.principalType,
    state.principalId,
    state.keyEpoch,
    executor,
  );

  if (!storedEpochKey) {
    throw new Error("Failed to load stored principal epoch key");
  }

  if (
    storedEpochKey.encapsulationPublicKey !== state.encapsulationPublicKey ||
    storedEpochKey.keyFingerprint !== state.keyFingerprint
  ) {
    throw new Error("Principal epoch key conflict");
  }

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
      membersJson: principalStates.membersJson,
      membershipRoot: principalStates.membershipRoot,
      signedAt: principalStates.signedAt,
      signerKeyId: principalStates.signerKeyId,
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

  return {
    principalType: row.principalType,
    principalId: row.principalId,
    version: row.version,
    prevStateHash: row.prevStateHash,
    keyEpoch: row.keyEpoch,
    encapsulationPublicKey: row.encapsulationPublicKey,
    keyFingerprint: row.keyFingerprint,
    members: parsePrincipalStateMembers(row.membersJson),
    membershipRoot: row.membershipRoot,
    signedAt: row.signedAt.toISOString(),
    signerKeyId: row.signerKeyId,
    signature: row.signature,
    stateHash: row.stateHash,
    createdAt: row.createdAt,
  };
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
