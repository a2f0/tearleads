import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../../sqlite/appDatabaseRuntime";
import {
  containerProjection,
  containers,
  containerTables,
} from "../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

export interface ContainerRecord {
  createdAt?: string | null;
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
  updatedAt?: string | null;
}

export async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, containerTables);
  await ensureContainerCreatedAtColumn(execSql);
}

interface SelectedContainerRecord {
  id: string | null;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
  createdAt: string | null;
  updatedAt: string;
}

function renderContainerSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function hasContainerColumn(
  execSql: ExecSql,
  columnName: string,
): Promise<boolean> {
  const rows = (await execSql(
    `PRAGMA table_info(${renderContainerSqlIdentifier("containers")})`,
  )) as Array<{ name?: unknown }>;

  return rows.some((row) => row.name === columnName);
}

async function ensureContainerCreatedAtColumn(execSql: ExecSql): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    if (!(await hasContainerColumn(lockedExecSql, "created_at"))) {
      await lockedExecSql(
        `ALTER TABLE ${renderContainerSqlIdentifier(
          "containers",
        )} ADD COLUMN ${renderContainerSqlIdentifier("created_at")} TEXT`,
      );
    }

    await lockedExecSql(`
      UPDATE ${renderContainerSqlIdentifier("containers")}
      SET ${renderContainerSqlIdentifier(
        "created_at",
      )} = ${renderContainerSqlIdentifier("updated_at")}
      WHERE ${renderContainerSqlIdentifier("created_at")} IS NULL
    `);
  });
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
    createdAt: row.createdAt ?? row.updatedAt,
    updatedAt: row.updatedAt,
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
    createdAt: record.createdAt ?? updatedAt,
    updatedAt,
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
        updatedAt: containerRow.updatedAt,
      },
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
      createdAt: containers.createdAt,
      updatedAt: containers.updatedAt,
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

export async function deleteContainers(
  execSql: ExecSql,
  ids: ReadonlyArray<string>,
): Promise<void> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) {
    return;
  }

  await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
    await tx
      .delete(containerProjection)
      .where(inArray(containerProjection.containerId, uniqueIds))
      .run();
    await tx.delete(containers).where(inArray(containers.id, uniqueIds)).run();
  });
}
