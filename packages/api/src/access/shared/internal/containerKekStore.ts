import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import type {
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyContainerKekState } from "@tearleads/crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { selectOneOrThrow } from "./selectOneOrThrow";

interface StoredContainerKeyEpoch extends ContainerKeyEpoch {
  readonly createdAt: Date;
}

interface StoredContainerKeyWrap extends ContainerKeyWrap {
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
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
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
): ContainerKeyEpoch {
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
): ContainerKeyWrap {
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

function containerKeyWrapConflictWhere(wrap: ContainerKeyWrap) {
  return and(
    eq(containerKeyWraps.containerKeyEpochId, wrap.containerKeyEpochId),
    eq(containerKeyWraps.recipientKind, wrap.recipientKind),
    eq(containerKeyWraps.recipientId, wrap.recipientId),
    eq(containerKeyWraps.recipientKeyEpochId, wrap.recipientKeyEpochId),
  );
}

interface ContainerKeyWrapConflictTarget {
  readonly containerKeyEpochId: string;
  readonly recipientKind: ContainerKeyWrap["recipientKind"];
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
}

function containerKeyWrapConflictKey(
  wrap: ContainerKeyWrapConflictTarget,
): string {
  return [
    wrap.containerKeyEpochId,
    wrap.recipientKind,
    wrap.recipientId,
    wrap.recipientKeyEpochId,
  ].join(":");
}

async function ensureStoredContainerKeyEpochMatches(
  keyEpoch: ContainerKeyEpoch,
  executor: DatabaseSession,
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
  wrap: ContainerKeyWrap,
  executor: DatabaseSession,
): Promise<void> {
  const storedWrap = await selectOneOrThrow(
    executor
      .select()
      .from(containerKeyWraps)
      .where(containerKeyWrapConflictWhere(wrap))
      .limit(1),
    "Failed to load stored container key wrap",
  );

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
  keyEpoch: ContainerKeyEpoch,
  executor: DatabaseSession,
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

async function insertContainerKeyWraps(
  wraps: readonly ContainerKeyWrap[],
  executor: DatabaseSession,
): Promise<void> {
  if (wraps.length === 0) {
    return;
  }

  const insertedWraps = await executor
    .insert(containerKeyWraps)
    .values(
      wraps.map((wrap) => ({
        containerKeyEpochId: wrap.containerKeyEpochId,
        recipientKind: wrap.recipientKind,
        recipientId: wrap.recipientId,
        recipientKeyEpochId: wrap.recipientKeyEpochId,
        recipientKeyFingerprint: wrap.recipientKeyFingerprint,
        kemCipherText: wrap.kemCipherText,
        wrappedKey: wrap.wrappedKey,
        wrapManifestHash: wrap.wrapManifestHash,
      })),
    )
    .onConflictDoNothing({
      target: [
        containerKeyWraps.containerKeyEpochId,
        containerKeyWraps.recipientKind,
        containerKeyWraps.recipientId,
        containerKeyWraps.recipientKeyEpochId,
      ],
    })
    .returning({
      containerKeyEpochId: containerKeyWraps.containerKeyEpochId,
      recipientKind: containerKeyWraps.recipientKind,
      recipientId: containerKeyWraps.recipientId,
      recipientKeyEpochId: containerKeyWraps.recipientKeyEpochId,
    });

  if (insertedWraps.length === wraps.length) {
    return;
  }

  const insertedWrapKeys = new Set(
    insertedWraps.map(containerKeyWrapConflictKey),
  );

  for (const wrap of wraps) {
    if (!insertedWrapKeys.has(containerKeyWrapConflictKey(wrap))) {
      await ensureStoredContainerKeyWrapMatches(wrap, executor);
    }
  }
}

async function deleteStaleContainerKeyWraps(
  containerKeyEpochId: string,
  currentWraps: readonly ContainerKeyWrap[],
  executor: DatabaseSession,
): Promise<void> {
  // The verifier treats the wrap set as exact for the current KEK state. When a
  // principal target is replaced on the same container KEK epoch, stale wraps
  // must stop being served from the current projection.
  const currentWrapKeys = new Set(
    currentWraps.map(containerKeyWrapConflictKey),
  );
  const staleWraps = (
    await listContainerKeyWraps(containerKeyEpochId, executor)
  ).filter((wrap) => !currentWrapKeys.has(containerKeyWrapConflictKey(wrap)));

  const staleWrapIds = staleWraps.map((wrap) => wrap.id);
  if (staleWrapIds.length > 0) {
    await executor
      .delete(containerKeyWraps)
      .where(inArray(containerKeyWraps.id, staleWrapIds));
  }
}

export async function storeVerifiedContainerKekState(
  input: StoreVerifiedContainerKekStateInput,
  database: ApiDatabase,
): Promise<VerifiedContainerKekState> {
  return database.transaction((tx) =>
    storeVerifiedContainerKekStateInTransaction(input, tx),
  );
}

export async function storeVerifiedContainerKekStateInTransaction(
  input: StoreVerifiedContainerKekStateInput,
  tx: DatabaseTransaction,
): Promise<VerifiedContainerKekState> {
  await insertContainerKeyEpoch(input.verifiedState.keyEpoch, tx);
  await deleteStaleContainerKeyWraps(
    input.verifiedState.containerKeyEpochId,
    input.verifiedState.wraps,
    tx,
  );
  await insertContainerKeyWraps(input.verifiedState.wraps, tx);

  return input.verifiedState;
}

export async function getContainerKeyEpochById(
  containerKeyEpochId: string,
  executor: DatabaseSession,
): Promise<StoredContainerKeyEpoch | null> {
  const [keyEpoch] = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, containerKeyEpochId))
    .limit(1);

  return keyEpoch ? toStoredContainerKeyEpoch(keyEpoch) : null;
}

export async function getContainerKeyEpochsById(
  containerKeyEpochIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredContainerKeyEpoch>> {
  const uniqueContainerKeyEpochIds = [...new Set(containerKeyEpochIds)].sort();

  if (uniqueContainerKeyEpochIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select()
    .from(containerKeyEpochs)
    .where(inArray(containerKeyEpochs.id, uniqueContainerKeyEpochIds));

  return new Map(rows.map((row) => [row.id, toStoredContainerKeyEpoch(row)]));
}

export async function listContainerKeyEpochs(
  containerId: string,
  executor: DatabaseSession,
): Promise<StoredContainerKeyEpoch[]> {
  const rows = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.containerId, containerId))
    .orderBy(asc(containerKeyEpochs.keyEpoch));

  return rows.map(toStoredContainerKeyEpoch);
}

export async function getCurrentContainerKeyEpoch(
  containerId: string,
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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
  executor: DatabaseSession,
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
