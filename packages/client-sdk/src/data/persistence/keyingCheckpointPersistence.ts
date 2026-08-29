import type {
  AccessManifestCheckpoint,
  AccessObjectKind,
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
} from "@symcrypt/crypto";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { and, eq } from "drizzle-orm";
import {
  accessManifestCheckpoints,
  keyingCheckpointTables,
  principalPolicyCheckpoints,
} from "../sqlite/schema";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import { recordPrincipalPolicyOrganizationInTransaction } from "./principalPolicyOrganizationPersistence";

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
  return rows[0] ?? null;
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

export async function upsertPrincipalPolicyCheckpointInTransaction(
  tx: ClientSQLiteTransactionScope,
  checkpoint: PrincipalPolicyCheckpoint,
  updatedAt: string,
  organizationId?: string | undefined,
): Promise<void> {
  await recordPrincipalPolicyOrganizationInTransaction(tx, {
    organizationId,
    principalId: checkpoint.principalId,
    principalType: checkpoint.principalType,
  });
  const row = { ...checkpoint, updatedAt };
  await tx
    .insert(principalPolicyCheckpoints)
    .values(row)
    .onConflictDoUpdate({
      target: [
        principalPolicyCheckpoints.principalType,
        principalPolicyCheckpoints.principalId,
      ],
      set: row,
    })
    .run();
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
