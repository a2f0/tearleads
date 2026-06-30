import type {
  AccessManifestCheckpoint,
  AccessObjectKind,
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import {
  accessManifestCheckpoints,
  keyingCheckpointTables,
  principalPolicyCheckpoints,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

function isAccessObjectKind(value: string): value is AccessObjectKind {
  return value === "blob" || value === "container" || value === "document";
}

function isManagedPrincipalKind(value: string): value is ManagedPrincipalKind {
  return value === "group" || value === "organization";
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
  const rows = await db
    .select({
      objectKind: accessManifestCheckpoints.objectKind,
      organizationId: accessManifestCheckpoints.organizationId,
      objectId: accessManifestCheckpoints.objectId,
      epoch: accessManifestCheckpoints.epoch,
      manifestHash: accessManifestCheckpoints.manifestHash,
    })
    .from(accessManifestCheckpoints)
    .where(
      and(
        eq(accessManifestCheckpoints.objectKind, objectKind),
        eq(accessManifestCheckpoints.organizationId, organizationId),
        eq(accessManifestCheckpoints.objectId, objectId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !isAccessObjectKind(row.objectKind)) {
    return null;
  }

  return {
    objectKind: row.objectKind,
    objectId: row.objectId,
    organizationId: row.organizationId,
    epoch: row.epoch,
    manifestHash: row.manifestHash,
  };
}

export async function saveAccessManifestCheckpoint(
  execSql: ExecSql,
  checkpoint: AccessManifestCheckpoint,
  updatedAt: string,
): Promise<void> {
  await ensureKeyingCheckpointTables(execSql);

  const nextRow = {
    objectKind: checkpoint.objectKind,
    organizationId: checkpoint.organizationId,
    objectId: checkpoint.objectId,
    epoch: checkpoint.epoch,
    manifestHash: checkpoint.manifestHash,
    updatedAt,
  };

  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    // Never regress the pin. Concurrent or out-of-order projection
    // verifications must not lower a previously recorded epoch, which would
    // silently weaken rollback detection. The read and write run inside the
    // serialized mutation, so they are atomic against other writers.
    const existing = await db
      .select({ epoch: accessManifestCheckpoints.epoch })
      .from(accessManifestCheckpoints)
      .where(
        and(
          eq(accessManifestCheckpoints.objectKind, checkpoint.objectKind),
          eq(
            accessManifestCheckpoints.organizationId,
            checkpoint.organizationId,
          ),
          eq(accessManifestCheckpoints.objectId, checkpoint.objectId),
        ),
      )
      .limit(1);
    if (existing[0] && existing[0].epoch >= checkpoint.epoch) {
      return;
    }
    await db
      .insert(accessManifestCheckpoints)
      .values(nextRow)
      .onConflictDoUpdate({
        target: [
          accessManifestCheckpoints.objectKind,
          accessManifestCheckpoints.organizationId,
          accessManifestCheckpoints.objectId,
        ],
        set: nextRow,
      })
      .run();
  });
}

export async function loadPrincipalPolicyCheckpoint(
  execSql: ExecSql,
  principalType: ManagedPrincipalKind,
  principalId: string,
): Promise<PrincipalPolicyCheckpoint | null> {
  await ensureKeyingCheckpointTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      principalType: principalPolicyCheckpoints.principalType,
      principalId: principalPolicyCheckpoints.principalId,
      version: principalPolicyCheckpoints.version,
      stateHash: principalPolicyCheckpoints.stateHash,
    })
    .from(principalPolicyCheckpoints)
    .where(
      and(
        eq(principalPolicyCheckpoints.principalType, principalType),
        eq(principalPolicyCheckpoints.principalId, principalId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !isManagedPrincipalKind(row.principalType)) {
    return null;
  }

  return {
    principalType: row.principalType,
    principalId: row.principalId,
    version: row.version,
    stateHash: row.stateHash,
  };
}

export async function savePrincipalPolicyCheckpoint(
  execSql: ExecSql,
  checkpoint: PrincipalPolicyCheckpoint,
  updatedAt: string,
): Promise<void> {
  await ensureKeyingCheckpointTables(execSql);

  const nextRow = {
    principalType: checkpoint.principalType,
    principalId: checkpoint.principalId,
    version: checkpoint.version,
    stateHash: checkpoint.stateHash,
    updatedAt,
  };

  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    // Never regress the pin (see saveAccessManifestCheckpoint): a slower or
    // out-of-order verification must not lower a previously recorded version.
    const existing = await db
      .select({ version: principalPolicyCheckpoints.version })
      .from(principalPolicyCheckpoints)
      .where(
        and(
          eq(
            principalPolicyCheckpoints.principalType,
            checkpoint.principalType,
          ),
          eq(principalPolicyCheckpoints.principalId, checkpoint.principalId),
        ),
      )
      .limit(1);
    if (existing[0] && existing[0].version >= checkpoint.version) {
      return;
    }
    await db
      .insert(principalPolicyCheckpoints)
      .values(nextRow)
      .onConflictDoUpdate({
        target: [
          principalPolicyCheckpoints.principalType,
          principalPolicyCheckpoints.principalId,
        ],
        set: nextRow,
      })
      .run();
  });
}
