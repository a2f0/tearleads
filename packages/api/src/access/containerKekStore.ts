import type {
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyContainerKekState } from "@tearleads/crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { containerKeyEpochs, containerKeyWraps } from "../schema";

type ContainerKekStoreExecutor = DatabaseExecutor;

interface StoredContainerKeyEpoch extends ContainerKeyEpochV2 {
  readonly createdAt: Date;
}

interface StoredContainerKeyWrap extends ContainerKeyWrapV2 {
  readonly id: string;
  readonly createdAt: Date;
}

interface StoreVerifiedContainerKekStateInput {
  readonly verifiedState: VerifiedContainerKekState;
}

interface ResolveStoredContainerKekStateInput {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly containerManifestHistory?: readonly VerifiedContainerAccessManifest[];
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userRecipientKeys?: readonly ContainerUserRecipientKeyV2[];
}

function toStoredContainerKeyEpoch(
  row: typeof containerKeyEpochs.$inferSelect,
): StoredContainerKeyEpoch {
  return {
    id: row.id,
    containerId: row.containerId,
    keyEpoch: row.keyEpoch,
    accessManifestHash: row.accessManifestHash,
    parentContainerKeyEpochId: row.parentContainerKeyEpochId,
    createdByEventHash: row.createdByEventHash,
    createdByManifestHash: row.createdByManifestHash,
    createdAt: row.createdAt,
  };
}

function toStoredContainerKeyWrap(
  row: typeof containerKeyWraps.$inferSelect,
): StoredContainerKeyWrap {
  return {
    id: row.id,
    containerKeyEpochId: row.containerKeyEpochId,
    recipientKind: row.recipientKind,
    recipientId: row.recipientId,
    recipientKeyEpochId: row.recipientKeyEpochId,
    recipientKeyFingerprint: row.recipientKeyFingerprint,
    kemCipherText: row.kemCipherText,
    wrappedKey: row.wrappedKey,
    wrapManifestHash: row.wrapManifestHash,
    createdAt: row.createdAt,
  };
}

function toContainerKeyEpoch(
  storedEpoch: StoredContainerKeyEpoch,
): ContainerKeyEpochV2 {
  return {
    id: storedEpoch.id,
    containerId: storedEpoch.containerId,
    keyEpoch: storedEpoch.keyEpoch,
    accessManifestHash: storedEpoch.accessManifestHash,
    parentContainerKeyEpochId: storedEpoch.parentContainerKeyEpochId,
    createdByEventHash: storedEpoch.createdByEventHash,
    createdByManifestHash: storedEpoch.createdByManifestHash,
  };
}

function toContainerKeyWrap(
  storedWrap: StoredContainerKeyWrap,
): ContainerKeyWrapV2 {
  return {
    containerKeyEpochId: storedWrap.containerKeyEpochId,
    recipientKind: storedWrap.recipientKind,
    recipientId: storedWrap.recipientId,
    recipientKeyEpochId: storedWrap.recipientKeyEpochId,
    recipientKeyFingerprint: storedWrap.recipientKeyFingerprint,
    kemCipherText: storedWrap.kemCipherText,
    wrappedKey: storedWrap.wrappedKey,
    wrapManifestHash: storedWrap.wrapManifestHash,
  };
}

function containerKeyWrapConflictWhere(wrap: ContainerKeyWrapV2) {
  return and(
    eq(containerKeyWraps.containerKeyEpochId, wrap.containerKeyEpochId),
    eq(containerKeyWraps.recipientKind, wrap.recipientKind),
    eq(containerKeyWraps.recipientId, wrap.recipientId),
    eq(containerKeyWraps.recipientKeyEpochId, wrap.recipientKeyEpochId),
  );
}

async function ensureStoredContainerKeyEpochMatches(
  keyEpoch: ContainerKeyEpochV2,
  executor: ContainerKekStoreExecutor,
): Promise<void> {
  const storedEpoch = await getContainerKeyEpochById(keyEpoch.id, executor);

  if (!storedEpoch) {
    throw new Error("Failed to load stored container key epoch");
  }

  if (
    storedEpoch.containerId !== keyEpoch.containerId ||
    storedEpoch.keyEpoch !== keyEpoch.keyEpoch ||
    storedEpoch.accessManifestHash !== keyEpoch.accessManifestHash ||
    storedEpoch.parentContainerKeyEpochId !==
      keyEpoch.parentContainerKeyEpochId ||
    storedEpoch.createdByEventHash !== keyEpoch.createdByEventHash ||
    storedEpoch.createdByManifestHash !== keyEpoch.createdByManifestHash
  ) {
    throw new Error("Container key epoch conflict");
  }
}

async function ensureStoredContainerKeyWrapMatches(
  wrap: ContainerKeyWrapV2,
  executor: ContainerKekStoreExecutor,
): Promise<void> {
  const [storedWrap] = await executor
    .select()
    .from(containerKeyWraps)
    .where(containerKeyWrapConflictWhere(wrap))
    .limit(1);

  if (!storedWrap) {
    throw new Error("Failed to load stored container key wrap");
  }

  if (
    storedWrap.recipientKeyFingerprint !== wrap.recipientKeyFingerprint ||
    storedWrap.kemCipherText !== wrap.kemCipherText ||
    storedWrap.wrappedKey !== wrap.wrappedKey ||
    storedWrap.wrapManifestHash !== wrap.wrapManifestHash
  ) {
    throw new Error("Container key wrap conflict");
  }
}

async function insertContainerKeyEpoch(
  keyEpoch: ContainerKeyEpochV2,
  executor: ContainerKekStoreExecutor,
): Promise<void> {
  const [insertedEpoch] = await executor
    .insert(containerKeyEpochs)
    .values({
      id: keyEpoch.id,
      containerId: keyEpoch.containerId,
      keyEpoch: keyEpoch.keyEpoch,
      accessManifestHash: keyEpoch.accessManifestHash,
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      createdByEventHash: keyEpoch.createdByEventHash,
      createdByManifestHash: keyEpoch.createdByManifestHash,
    })
    .onConflictDoNothing({ target: containerKeyEpochs.id })
    .returning();

  if (!insertedEpoch) {
    await ensureStoredContainerKeyEpochMatches(keyEpoch, executor);
  }
}

async function insertContainerKeyWrap(
  wrap: ContainerKeyWrapV2,
  executor: ContainerKekStoreExecutor,
): Promise<void> {
  const [insertedWrap] = await executor
    .insert(containerKeyWraps)
    .values({
      containerKeyEpochId: wrap.containerKeyEpochId,
      recipientKind: wrap.recipientKind,
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      kemCipherText: wrap.kemCipherText,
      wrappedKey: wrap.wrappedKey,
      wrapManifestHash: wrap.wrapManifestHash,
    })
    .onConflictDoNothing({
      target: [
        containerKeyWraps.containerKeyEpochId,
        containerKeyWraps.recipientKind,
        containerKeyWraps.recipientId,
        containerKeyWraps.recipientKeyEpochId,
      ],
    })
    .returning();

  if (!insertedWrap) {
    await ensureStoredContainerKeyWrapMatches(wrap, executor);
  }
}

export async function storeVerifiedContainerKekState(
  input: StoreVerifiedContainerKekStateInput,
  executor: ContainerKekStoreExecutor = db,
): Promise<VerifiedContainerKekState> {
  if (executor === db) {
    return db.transaction(async (tx) =>
      storeVerifiedContainerKekState(input, tx),
    );
  }

  await insertContainerKeyEpoch(input.verifiedState.keyEpoch, executor);
  for (const wrap of input.verifiedState.wraps) {
    await insertContainerKeyWrap(wrap, executor);
  }

  return input.verifiedState;
}

async function getContainerKeyEpochById(
  containerKeyEpochId: string,
  executor: ContainerKekStoreExecutor = db,
): Promise<StoredContainerKeyEpoch | null> {
  const [keyEpoch] = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, containerKeyEpochId))
    .limit(1);

  return keyEpoch ? toStoredContainerKeyEpoch(keyEpoch) : null;
}

export async function getCurrentContainerKeyEpoch(
  containerId: string,
  executor: ContainerKekStoreExecutor = db,
): Promise<StoredContainerKeyEpoch | null> {
  const [keyEpoch] = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, containerId))
    .orderBy(desc(containerKeyEpochs.keyEpoch))
    .limit(1);

  return keyEpoch ? toStoredContainerKeyEpoch(keyEpoch) : null;
}

export async function listContainerKeyWraps(
  containerKeyEpochId: string,
  executor: ContainerKekStoreExecutor = db,
): Promise<StoredContainerKeyWrap[]> {
  const wraps = await executor
    .select()
    .from(containerKeyWraps)
    .where(eq(containerKeyWraps.containerKeyEpochId, containerKeyEpochId))
    .orderBy(
      asc(containerKeyWraps.recipientKind),
      asc(containerKeyWraps.recipientId),
      asc(containerKeyWraps.recipientKeyEpochId),
    );

  return wraps.map(toStoredContainerKeyWrap);
}

export async function resolveStoredContainerKekState(
  input: ResolveStoredContainerKekStateInput,
  executor: ContainerKekStoreExecutor = db,
): Promise<VerifiedContainerKekState> {
  const containerKeyEpochId = input.containerManifest.state.containerKeyEpochId;
  if (!containerKeyEpochId) {
    throw new Error("Container manifest has no container key epoch id");
  }

  const keyEpoch = await getContainerKeyEpochById(
    containerKeyEpochId,
    executor,
  );
  if (!keyEpoch) {
    throw new Error("Container key epoch not found");
  }

  const wraps = await listContainerKeyWraps(containerKeyEpochId, executor);
  const verified = await verifyContainerKekState({
    containerManifest: input.containerManifest,
    containerManifestHistory: input.containerManifestHistory ?? [],
    keyEpoch: toContainerKeyEpoch(keyEpoch),
    parentKekState: input.parentKekState ?? null,
    principalPolicies: input.principalPolicies ?? [],
    userRecipientKeys: input.userRecipientKeys ?? [],
    wraps: wraps.map(toContainerKeyWrap),
  });

  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}
