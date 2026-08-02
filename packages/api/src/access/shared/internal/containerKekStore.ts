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
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyContainerKekState } from "@tearleads/crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type {
  StoredContainerKeyEpoch,
  StoredContainerKeyWrap,
} from "./containerKekStoreRecords";
import {
  containerKeyWrapConflictKey,
  containerKeyWrapConflictWhere,
  keyringsEqual,
  predecessorBridgesEqual,
  toContainerKeyEpoch,
  toContainerKeyWrap,
  toStoredContainerKeyEpoch,
  toStoredContainerKeyWrap,
} from "./containerKekStoreRecords";
import { selectOneOrThrow } from "./selectOneOrThrow";

interface StoreVerifiedContainerKekStateInput {
  readonly keyring: ContainerKekKeyring | null;
  readonly predecessorBridge: ContainerKekPredecessorBridge | null;
  readonly verifiedState: VerifiedContainerKekState;
}

interface ResolveStoredContainerKekStateInput {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly containerManifestHistory?: readonly VerifiedContainerAccessManifest[];
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}

async function ensureStoredContainerKeyEpochMatches(
  keyEpoch: ContainerKeyEpoch,
  predecessorBridge: ContainerKekPredecessorBridge | null,
  keyring: ContainerKekKeyring | null,
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
    storedEpoch.createdByManifestHash !== keyEpoch.createdByManifestHash ||
    !predecessorBridgesEqual(
      storedEpoch.predecessorBridge,
      predecessorBridge,
    ) ||
    !keyringsEqual(storedEpoch.keyring, keyring)
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
  predecessorBridge: ContainerKekPredecessorBridge | null,
  keyring: ContainerKekKeyring | null,
  executor: DatabaseSession,
): Promise<void> {
  if ((predecessorBridge === null) !== (keyring === null)) {
    throw new Error(
      "Container key epoch rotation artifacts must be stored together",
    );
  }
  const [insertedEpoch] = await executor
    .insert(containerKeyEpochs)
    .values({
      id: keyEpoch.id,
      containerId: keyEpoch.containerId,
      keyEpoch: keyEpoch.keyEpoch,
      accessManifestHash: keyEpoch.accessManifestHash,
      parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
      predecessorContainerKeyEpochId:
        predecessorBridge?.predecessorContainerKeyEpochId ?? null,
      predecessorBridgeVersion: predecessorBridge?.version ?? null,
      predecessorBridgeSuite: predecessorBridge?.wrappingSuite ?? null,
      predecessorBridgeIv: predecessorBridge?.iv ?? null,
      wrappedPredecessorKey: predecessorBridge?.wrappedKey ?? null,
      keyringIv: keyring?.iv ?? null,
      sealedKeyring: keyring?.sealed ?? null,
      createdByEventHash: keyEpoch.createdByEventHash,
      createdByManifestHash: keyEpoch.createdByManifestHash,
    })
    .onConflictDoNothing({ target: containerKeyEpochs.id })
    .returning();

  if (!insertedEpoch) {
    await ensureStoredContainerKeyEpochMatches(
      keyEpoch,
      predecessorBridge,
      keyring,
      executor,
    );
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
  await insertContainerKeyEpoch(
    input.verifiedState.keyEpoch,
    input.predecessorBridge,
    input.keyring,
    tx,
  );
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

/** Reads one epoch's sealed keyring — the only place the blob is selected. */
export async function getContainerKeyEpochKeyring(
  containerKeyEpochId: string,
  executor: DatabaseSession,
): Promise<ContainerKekKeyring | null> {
  const [row] = await executor
    .select()
    .from(containerKeyEpochs)
    .where(eq(containerKeyEpochs.id, containerKeyEpochId))
    .limit(1);
  return row ? toStoredContainerKeyEpoch(row).keyring : null;
}

/**
 * One query for many epochs' wraps, grouped by epoch id — the per-epoch
 * variant would issue a statement per epoch, which grows with rotation
 * count on history reads.
 */
/**
 * One bounded page of a container's epochs, selected in SQL. Keyring blobs
 * are the expensive column — each is O(its epoch) bytes — so they load only
 * when asked for. Fetches `limit + 1` rows to report whether more remain
 * without a second query.
 */
export async function listContainerKeyEpochPage(
  input: {
    readonly afterKeyEpoch: number;
    readonly containerId: string;
    readonly limit: number;
  },
  executor: DatabaseSession,
): Promise<{
  readonly epochs: StoredContainerKeyEpoch[];
  readonly hasMore: boolean;
}> {
  const rows = await executor
    .select({
      accessManifestHash: containerKeyEpochs.accessManifestHash,
      containerId: containerKeyEpochs.containerId,
      createdAt: containerKeyEpochs.createdAt,
      createdByEventHash: containerKeyEpochs.createdByEventHash,
      createdByManifestHash: containerKeyEpochs.createdByManifestHash,
      id: containerKeyEpochs.id,
      keyEpoch: containerKeyEpochs.keyEpoch,
      // The keyring columns are never selected here: they are O(epoch) bytes
      // each, so selecting a page of them would read gigabytes to serve one.
      // getContainerKeyEpochKeyring fetches the single requested blob.
      keyringIv: sql<null>`null`,
      parentContainerKeyEpochId: containerKeyEpochs.parentContainerKeyEpochId,
      predecessorBridgeIv: containerKeyEpochs.predecessorBridgeIv,
      predecessorBridgeSuite: containerKeyEpochs.predecessorBridgeSuite,
      predecessorBridgeVersion: containerKeyEpochs.predecessorBridgeVersion,
      predecessorContainerKeyEpochId:
        containerKeyEpochs.predecessorContainerKeyEpochId,
      sealedKeyring: sql<null>`null`,
      wrappedPredecessorKey: containerKeyEpochs.wrappedPredecessorKey,
    })
    .from(containerKeyEpochs)
    .where(
      and(
        eq(containerKeyEpochs.containerId, input.containerId),
        gt(containerKeyEpochs.keyEpoch, input.afterKeyEpoch),
      ),
    )
    .orderBy(asc(containerKeyEpochs.keyEpoch))
    .limit(input.limit + 1);

  return {
    epochs: rows.slice(0, input.limit).map(toStoredContainerKeyEpoch),
    hasMore: rows.length > input.limit,
  };
}

export async function listContainerKeyWrapsByEpochId(
  containerKeyEpochIds: readonly string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredContainerKeyWrap[]>> {
  const uniqueIds = [...new Set(containerKeyEpochIds)];
  const wrapsByEpochId = new Map<string, StoredContainerKeyWrap[]>(
    uniqueIds.map((id) => [id, []]),
  );
  if (uniqueIds.length === 0) {
    return wrapsByEpochId;
  }

  const rows = await executor
    .select()
    .from(containerKeyWraps)
    .where(inArray(containerKeyWraps.containerKeyEpochId, uniqueIds))
    .orderBy(
      asc(containerKeyWraps.containerKeyEpochId),
      asc(containerKeyWraps.recipientKind),
      asc(containerKeyWraps.recipientId),
      asc(containerKeyWraps.recipientKeyEpochId),
    );

  for (const row of rows) {
    wrapsByEpochId
      .get(row.containerKeyEpochId)
      ?.push(toStoredContainerKeyWrap(row));
  }
  return wrapsByEpochId;
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
