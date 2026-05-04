import { asc, eq, sql } from "drizzle-orm";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../appDatabaseRuntime";
import { containerProjection, containers, containerTables } from "../schema";
import { type ExecSql, ensureSqlTables } from "../sqlSchema";

export interface ContainerRecord {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
}

export async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, containerTables);
}

interface SelectedContainerRecord {
  id: string | null;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
}

function mapSelectedContainerRecord(
  row: SelectedContainerRecord,
): ContainerRecord {
  return {
    id: String(row.id ?? ""),
    organizationId: row.organizationId,
    parentId: row.parentId,
    metadataDocumentId: row.metadataDocumentId,
    name: row.name,
    icon: row.icon && row.icon.length > 0 ? row.icon : null,
  };
}

export async function saveContainerRows(input: {
  tx: AppSQLiteTransaction;
  record: ContainerRecord;
  updatedAt: string;
}): Promise<void> {
  const { record, tx, updatedAt } = input;
  const containerRow = {
    id: record.id,
    organizationId: record.organizationId,
    parentId: record.parentId,
    metadataDocumentId: record.metadataDocumentId,
    updatedAt,
  };
  await tx
    .insert(containers)
    .values(containerRow)
    .onConflictDoUpdate({
      target: containers.id,
      set: containerRow,
    })
    .run();

  const projectionRow = {
    containerId: record.id,
    displayName: record.name,
    icon: record.icon,
    updatedAt,
  };
  await tx
    .insert(containerProjection)
    .values(projectionRow)
    .onConflictDoUpdate({
      target: containerProjection.containerId,
      set: projectionRow,
    })
    .run();
}

export async function loadContainers(
  execSql: ExecSql,
): Promise<ContainerRecord[]> {
  const { db } = getAppDatabaseRuntime(execSql);
  const name = sql<string>`COALESCE(
    ${containerProjection.displayName},
    CASE WHEN ${containers.parentId} IS NULL THEN '/' ELSE 'Untitled' END
  )`;
  const rows = await db
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      metadataDocumentId: containers.metadataDocumentId,
      name,
      icon: containerProjection.icon,
    })
    .from(containers)
    .leftJoin(
      containerProjection,
      eq(containerProjection.containerId, containers.id),
    )
    .orderBy(asc(sql`${name} COLLATE NOCASE`));

  return rows.map((row) => mapSelectedContainerRecord(row));
}

export async function saveContainer(
  execSql: ExecSql,
  record: ContainerRecord,
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
    await saveContainerRows({
      record,
      tx,
      updatedAt,
    });
  });
}

export async function deleteContainer(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
    await tx
      .delete(containerProjection)
      .where(eq(containerProjection.containerId, id))
      .run();
    await tx.delete(containers).where(eq(containers.id, id)).run();
  });
}
