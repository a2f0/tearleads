import type {
  AccessManifestCheckpoint,
  AccessObjectKind,
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import { KeyingVerificationError } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  accessManifestCheckpoints,
  keyingCheckpointTables,
  principalPolicyCheckpoints,
} from "../../sqlite/schema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { writePrincipalPolicyCheckpointRowsInTransaction } from "./principalPolicyOrganizationPersistence";

type CheckpointHandle = ClientSQLiteDatabase | ClientSQLiteTransactionScope;

type AccessManifestCheckpointIdentity = Pick<
  AccessManifestCheckpoint,
  "objectKind" | "organizationId" | "objectId"
>;

type PrincipalPolicyCheckpointIdentity = Pick<
  PrincipalPolicyCheckpoint,
  "principalType" | "principalId"
>;

/** One key format per checkpoint identity, shared by every batch validator. */
export function accessManifestObjectKey(
  identity: AccessManifestCheckpointIdentity,
): string {
  return JSON.stringify([
    identity.objectKind,
    identity.organizationId,
    identity.objectId,
  ]);
}

export function principalPolicyKey(
  identity: PrincipalPolicyCheckpointIdentity,
): string {
  return JSON.stringify([identity.principalType, identity.principalId]);
}

async function loadAccessManifestCheckpointRow(
  handle: CheckpointHandle,
  identity: AccessManifestCheckpointIdentity,
): Promise<Pick<AccessManifestCheckpoint, "epoch" | "manifestHash"> | null> {
  const rows = await handle
    .select({
      epoch: accessManifestCheckpoints.epoch,
      manifestHash: accessManifestCheckpoints.manifestHash,
    })
    .from(accessManifestCheckpoints)
    .where(
      and(
        eq(accessManifestCheckpoints.objectKind, identity.objectKind),
        eq(accessManifestCheckpoints.organizationId, identity.organizationId),
        eq(accessManifestCheckpoints.objectId, identity.objectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The pin a stored row carries: an owned-but-unpinned row is no checkpoint,
 * and a half-written pin is refused rather than read as either.
 */
function storedPrincipalPolicyPin(row: {
  readonly version: number | null;
  readonly stateHash: string | null;
}): Pick<PrincipalPolicyCheckpoint, "version" | "stateHash"> | null {
  if (row.version === null && row.stateHash === null) return null;
  if (row.version === null || row.stateHash === null)
    throw new KeyingVerificationError(
      "invalid_shape",
      "principal policy checkpoint is malformed",
    );
  return { version: row.version, stateHash: row.stateHash };
}

async function loadPrincipalPolicyCheckpointRow(
  handle: CheckpointHandle,
  identity: PrincipalPolicyCheckpointIdentity,
): Promise<Pick<PrincipalPolicyCheckpoint, "version" | "stateHash"> | null> {
  const rows = await handle
    .select({
      version: principalPolicyCheckpoints.version,
      stateHash: principalPolicyCheckpoints.stateHash,
    })
    .from(principalPolicyCheckpoints)
    .where(
      and(
        eq(principalPolicyCheckpoints.principalType, identity.principalType),
        eq(principalPolicyCheckpoints.principalId, identity.principalId),
      ),
    )
    .limit(1);
  return rows[0] ? storedPrincipalPolicyPin(rows[0]) : null;
}

// An access lookup binds its kind and organization once; a policy lookup its type.
const ACCESS_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 2);
const POLICY_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(1, 1);
const ACCESS_WRITE_BATCH_SIZE = sqliteInsertBatchSize(
  accessManifestCheckpoints,
);

/** Splits `values` into consecutive slices of at most `size`. */
function checkpointBatches<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

/** Distinct ids per group key, in first-seen order. */
function groupIds<T>(
  items: readonly T[],
  group: (item: T) => string,
  id: (item: T) => string,
): Map<string, { readonly first: T; readonly ids: string[] }> {
  const groups = new Map<string, { first: T; ids: string[] }>();
  for (const item of items) {
    const entry = groups.get(group(item)) ?? { first: item, ids: [] };
    if (!entry.ids.includes(id(item))) entry.ids.push(id(item));
    groups.set(group(item), entry);
  }
  return groups;
}

/**
 * Every stored access checkpoint row for `identities`, keyed by
 * `accessManifestObjectKey`: one read per object kind and organization.
 */
export async function loadAccessManifestCheckpointRows(
  handle: CheckpointHandle,
  identities: readonly AccessManifestCheckpointIdentity[],
): Promise<
  Map<string, Pick<AccessManifestCheckpoint, "epoch" | "manifestHash">>
> {
  const stored = new Map<
    string,
    Pick<AccessManifestCheckpoint, "epoch" | "manifestHash">
  >();
  const groups = groupIds(
    identities,
    (identity) =>
      JSON.stringify([identity.objectKind, identity.organizationId]),
    (identity) => identity.objectId,
  );
  for (const { first, ids } of groups.values())
    for (const batch of checkpointBatches(ids, ACCESS_LOOKUP_BATCH_SIZE)) {
      const rows = await handle
        .select({
          objectId: accessManifestCheckpoints.objectId,
          epoch: accessManifestCheckpoints.epoch,
          manifestHash: accessManifestCheckpoints.manifestHash,
        })
        .from(accessManifestCheckpoints)
        .where(
          and(
            eq(accessManifestCheckpoints.objectKind, first.objectKind),
            eq(accessManifestCheckpoints.organizationId, first.organizationId),
            inArray(accessManifestCheckpoints.objectId, batch),
          ),
        );
      for (const { objectId, ...row } of rows)
        stored.set(accessManifestObjectKey({ ...first, objectId }), row);
    }
  return stored;
}

/**
 * Every stored policy checkpoint for `identities`, keyed by
 * `principalPolicyKey`: one read per principal type. Owned principals without
 * a pin are absent.
 */
export async function loadStoredPrincipalPolicyCheckpoints(
  handle: CheckpointHandle,
  identities: readonly PrincipalPolicyCheckpointIdentity[],
): Promise<Map<string, PrincipalPolicyCheckpoint>> {
  const stored = new Map<string, PrincipalPolicyCheckpoint>();
  const groups = groupIds(
    identities,
    (identity) => identity.principalType,
    (identity) => identity.principalId,
  );
  for (const { first, ids } of groups.values())
    for (const batch of checkpointBatches(ids, POLICY_LOOKUP_BATCH_SIZE)) {
      const rows = await handle
        .select({
          principalId: principalPolicyCheckpoints.principalId,
          version: principalPolicyCheckpoints.version,
          stateHash: principalPolicyCheckpoints.stateHash,
        })
        .from(principalPolicyCheckpoints)
        .where(
          and(
            eq(principalPolicyCheckpoints.principalType, first.principalType),
            inArray(principalPolicyCheckpoints.principalId, batch),
          ),
        );
      for (const row of rows) {
        const pin = storedPrincipalPolicyPin(row);
        if (!pin) continue;
        const checkpoint = {
          principalType: first.principalType,
          principalId: row.principalId,
          ...pin,
        };
        stored.set(principalPolicyKey(checkpoint), checkpoint);
      }
    }
  return stored;
}

/**
 * A loaded checkpoint row merged back with the identity it was looked up by —
 * the full checkpoint shape every comparison consumes.
 */
export async function loadStoredAccessManifestCheckpoint(
  handle: CheckpointHandle,
  checkpoint: AccessManifestCheckpoint,
): Promise<AccessManifestCheckpoint | null> {
  const row = await loadAccessManifestCheckpointRow(handle, checkpoint);
  return row ? { ...checkpoint, ...row } : null;
}

export async function loadStoredPrincipalPolicyCheckpoint(
  handle: CheckpointHandle,
  identity: PrincipalPolicyCheckpointIdentity,
): Promise<PrincipalPolicyCheckpoint | null> {
  const row = await loadPrincipalPolicyCheckpointRow(handle, identity);
  return row
    ? {
        principalType: identity.principalType,
        principalId: identity.principalId,
        ...row,
      }
    : null;
}

export async function upsertAccessManifestCheckpointInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoint: AccessManifestCheckpoint,
  updatedAt: string,
): Promise<void> {
  const row = { ...checkpoint, updatedAt };
  await tx
    .insert(accessManifestCheckpoints)
    .values(row)
    .onConflictDoUpdate({
      target: [
        accessManifestCheckpoints.objectKind,
        accessManifestCheckpoints.organizationId,
        accessManifestCheckpoints.objectId,
      ],
      set: row,
    })
    .run();
}

/**
 * Pins one checkpoint and records its owner in the same row; a principal
 * already owned by another organization is refused.
 */
export async function upsertPrincipalPolicyCheckpointInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoint: PrincipalPolicyCheckpoint,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  await writePrincipalPolicyCheckpointRowsInTransaction(
    tx,
    [checkpoint],
    updatedAt,
    organizationId,
  );
}

/**
 * Upserts every checkpoint in multi-row statements; a repeated identity keeps
 * its last checkpoint, as sequential upserts would.
 */
export async function upsertAccessManifestCheckpointsInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoints: readonly AccessManifestCheckpoint[],
  updatedAt: string,
): Promise<void> {
  const rows = new Map(
    checkpoints.map((checkpoint) => [
      accessManifestObjectKey(checkpoint),
      {
        objectKind: checkpoint.objectKind,
        organizationId: checkpoint.organizationId,
        objectId: checkpoint.objectId,
        epoch: checkpoint.epoch,
        manifestHash: checkpoint.manifestHash,
        updatedAt,
      },
    ]),
  );
  for (const batch of checkpointBatches(
    [...rows.values()],
    ACCESS_WRITE_BATCH_SIZE,
  ))
    await tx
      .insert(accessManifestCheckpoints)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          accessManifestCheckpoints.objectKind,
          accessManifestCheckpoints.organizationId,
          accessManifestCheckpoints.objectId,
        ],
        set: {
          epoch: excludedValue(accessManifestCheckpoints.epoch),
          manifestHash: excludedValue(accessManifestCheckpoints.manifestHash),
          updatedAt: excludedValue(accessManifestCheckpoints.updatedAt),
        },
      })
      .run();
}

/**
 * Records every checkpoint's cache ownership with its pin, failing on the
 * first conflict in order as `upsertPrincipalPolicyCheckpointInTransaction`
 * would, in multi-row statements; a repeated identity keeps its last
 * checkpoint.
 */
export async function upsertPrincipalPolicyCheckpointsInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoints: readonly PrincipalPolicyCheckpoint[],
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  await writePrincipalPolicyCheckpointRowsInTransaction(
    tx,
    checkpoints,
    updatedAt,
    organizationId,
  );
}

// Lazily create the checkpoint tables on first access. Every load/save below
// calls this, so the tables exist on demand; it is intentionally module-private
// (no caller outside this file needs it, and exporting it tripped knip).
async function ensureKeyingCheckpointTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, keyingCheckpointTables);
}

export async function loadAccessManifestCheckpoint(
  execSql: ExecSql,
  objectKind: AccessObjectKind,
  organizationId: string,
  objectId: string,
): Promise<AccessManifestCheckpoint | null> {
  await ensureKeyingCheckpointTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const row = await loadAccessManifestCheckpointRow(db, {
    objectKind,
    organizationId,
    objectId,
  });

  return row ? { objectKind, objectId, organizationId, ...row } : null;
}

export async function loadPrincipalPolicyCheckpoint(
  execSql: ExecSql,
  principalType: ManagedPrincipalKind,
  principalId: string,
): Promise<PrincipalPolicyCheckpoint | null> {
  await ensureKeyingCheckpointTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const row = await loadPrincipalPolicyCheckpointRow(db, {
    principalType,
    principalId,
  });

  return row ? { principalType, principalId, ...row } : null;
}
/**
 * The shared shape/ownership guard every checkpoint comparison runs before
 * trusting a durable pin: the pin must belong to the compared principal and
 * carry a well-formed version and hash.
 */
export function assertPrincipalPolicyCheckpointShape(
  checkpoint: PrincipalPolicyCheckpoint,
  head: PrincipalPolicyCheckpointIdentity,
): void {
  if (
    checkpoint.principalType !== head.principalType ||
    checkpoint.principalId !== head.principalId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "principal policy checkpoint belongs to another principal",
    );
  }
  if (
    !Number.isInteger(checkpoint.version) ||
    checkpoint.version < 1 ||
    checkpoint.stateHash.length === 0
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "principal policy checkpoint is malformed",
    );
  }
}
