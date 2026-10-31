import type { ContainerAccessLevel } from "@tearleads/crypto";
import {
  type ContainerSystemSlot,
  isContainerSystemSlot,
} from "@tearleads/validators/containerSystemSlot";
import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_EFFECTIVE_ACCESS_LEVEL,
  normalizeEffectiveAccessLevel,
} from "../../keying/accessLevel";
import { containers, containerTables } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

export interface ContainerRecord {
  createdAt?: string | null;
  effectiveAccessLevel?: ContainerAccessLevel | null;
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  systemSlot?: ContainerSystemSlot | null;
  name: string;
  icon: string | null;
  localCreatedAt?: string | null;
  localUpdatedAt?: string | null;
  serverCreatedAt?: string | null;
  serverUpdatedAt?: string | null;
  updatedAt?: string | null;
}

interface ContainerRecordWithTimestampDefaults extends ContainerRecord {
  createdAt: string | null;
  localCreatedAt: string;
  localUpdatedAt: string;
  serverCreatedAt: string | null;
  serverUpdatedAt: string | null;
  updatedAt: string | null;
}

export function ensureContainerTables(execSql: ExecSql): Promise<void> {
  return ensureSqlTables(execSql, containerTables);
}

// The ONE display-name fallback: a decrypted metadata name names the container;
// without one the root reads '/' and everything else 'Untitled'.
const containerDisplayName = sql<string>`COALESCE(
    ${containers.displayName},
    CASE WHEN ${containers.parentId} IS NULL THEN '/' ELSE 'Untitled' END
  )`;

interface SelectedContainerRecord {
  effectiveAccessLevel: string | null;
  id: string | null;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  systemSlot: string | null;
  name: string;
  icon: string | null;
  localCreatedAt: string;
  localUpdatedAt: string;
  serverCreatedAt: string | null;
  serverUpdatedAt: string | null;
}

function toDisplayContainerRecord(record: ContainerRecord): ContainerRecord {
  return {
    ...record,
    createdAt: record.serverCreatedAt ?? record.localCreatedAt ?? null,
    updatedAt: record.serverUpdatedAt ?? record.localUpdatedAt ?? null,
  };
}

function applyContainerTimestampDefaults(
  record: ContainerRecord,
  localUpdatedAt: string,
): ContainerRecordWithTimestampDefaults {
  const hasServerTimestamps =
    record.serverCreatedAt !== undefined ||
    record.serverUpdatedAt !== undefined;
  const localCreatedAt =
    record.localCreatedAt ??
    (!hasServerTimestamps ? record.createdAt : null) ??
    localUpdatedAt;
  const serverCreatedAt = record.serverCreatedAt ?? null;
  const serverUpdatedAt = record.serverUpdatedAt ?? null;

  return {
    ...record,
    createdAt: serverCreatedAt ?? localCreatedAt,
    localCreatedAt,
    localUpdatedAt,
    serverCreatedAt,
    serverUpdatedAt,
    updatedAt: serverUpdatedAt ?? localUpdatedAt,
  };
}

export function mapSelectedContainerRecord(
  row: SelectedContainerRecord,
): ContainerRecord {
  const systemSlot = isContainerSystemSlot(row.systemSlot)
    ? row.systemSlot
    : null;

  return toDisplayContainerRecord({
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      row.effectiveAccessLevel,
    ),
    id: String(row.id ?? ""),
    organizationId: row.organizationId,
    parentId: row.parentId,
    metadataDocumentId: row.metadataDocumentId,
    systemSlot,
    name: row.name,
    icon: row.icon && row.icon.length > 0 ? row.icon : null,
    localCreatedAt: row.localCreatedAt,
    localUpdatedAt: row.localUpdatedAt,
    serverCreatedAt: row.serverCreatedAt,
    serverUpdatedAt: row.serverUpdatedAt,
  });
}

export async function saveContainerRows(input: {
  tx: ClientSQLiteTransactionScope;
  record: ContainerRecord;
  localUpdatedAt: string;
}): Promise<ContainerRecord> {
  const { record, tx, localUpdatedAt } = input;
  const nextRecord = applyContainerTimestampDefaults(record, localUpdatedAt);
  const containerRow = {
    effectiveAccessLevel:
      nextRecord.effectiveAccessLevel ?? DEFAULT_EFFECTIVE_ACCESS_LEVEL,
    id: nextRecord.id,
    organizationId: nextRecord.organizationId,
    parentId: nextRecord.parentId,
    metadataDocumentId: nextRecord.metadataDocumentId,
    systemSlot: nextRecord.systemSlot ?? null,
    displayName: nextRecord.name,
    icon: nextRecord.icon,
    localCreatedAt: nextRecord.localCreatedAt,
    localUpdatedAt,
    serverCreatedAt: nextRecord.serverCreatedAt,
    serverUpdatedAt: nextRecord.serverUpdatedAt,
  };
  await tx
    .insert(containers)
    .values(containerRow)
    .onConflictDoUpdate({
      target: containers.id,
      set: {
        organizationId: containerRow.organizationId,
        parentId: containerRow.parentId,
        metadataDocumentId: containerRow.metadataDocumentId,
        systemSlot: containerRow.systemSlot,
        displayName: containerRow.displayName,
        icon: containerRow.icon,
        effectiveAccessLevel: containerRow.effectiveAccessLevel,
        localUpdatedAt: containerRow.localUpdatedAt,
        serverCreatedAt:
          record.serverCreatedAt === undefined
            ? sql`${containers.serverCreatedAt}`
            : containerRow.serverCreatedAt,
        serverUpdatedAt:
          record.serverUpdatedAt === undefined
            ? sql`${containers.serverUpdatedAt}`
            : containerRow.serverUpdatedAt,
      },
    })
    .run();

  return nextRecord;
}

/** The ONE select shape for a container record list. */
export const containerRecordSelection = {
  effectiveAccessLevel: containers.effectiveAccessLevel,
  id: containers.id,
  organizationId: containers.organizationId,
  parentId: containers.parentId,
  metadataDocumentId: containers.metadataDocumentId,
  systemSlot: containers.systemSlot,
  name: containerDisplayName,
  icon: containers.icon,
  localCreatedAt: containers.localCreatedAt,
  localUpdatedAt: containers.localUpdatedAt,
  serverCreatedAt: containers.serverCreatedAt,
  serverUpdatedAt: containers.serverUpdatedAt,
};

/** Container lists sort by display name, case-insensitively. */
export const containerListOrder = asc(
  sql`${containerDisplayName} COLLATE NOCASE`,
);

export async function loadContainers(
  execSql: ExecSql,
): Promise<ContainerRecord[]> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(containerRecordSelection)
    .from(containers)
    .orderBy(containerListOrder);

  return rows.map((row) => mapSelectedContainerRecord(row));
}

export async function loadContainerById(
  execSql: ExecSql,
  containerId: string,
): Promise<ContainerRecord | null> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      effectiveAccessLevel: containers.effectiveAccessLevel,
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      metadataDocumentId: containers.metadataDocumentId,
      systemSlot: containers.systemSlot,
      name: containerDisplayName,
      icon: containers.icon,
      localCreatedAt: containers.localCreatedAt,
      localUpdatedAt: containers.localUpdatedAt,
      serverCreatedAt: containers.serverCreatedAt,
      serverUpdatedAt: containers.serverUpdatedAt,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return rows[0] ? mapSelectedContainerRecord(rows[0]) : null;
}

export async function loadContainerDisplayNamesByIds(
  execSql: ExecSql,
  ids: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      id: containers.id,
      name: containerDisplayName,
    })
    .from(containers)
    .where(inArray(containers.id, uniqueIds));

  return new Map(
    rows.flatMap((row) => {
      const displayName = row.name.trim();
      if (!row.id || displayName.length === 0) {
        return [];
      }

      return [[row.id, displayName]];
    }),
  );
}

export async function saveContainer(
  execSql: ExecSql,
  record: ContainerRecord,
): Promise<void> {
  const localUpdatedAt = new Date().toISOString();

  await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    await saveContainerRows({
      record,
      tx,
      localUpdatedAt,
    });
  });
}

/**
 * The container-row half of the delete cascade, statement-only so callers
 * can compose it inside one atomic transaction.
 */
export async function deleteContainerRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return;
  }
  await tx.delete(containers).where(inArray(containers.id, uniqueIds)).run();
}
