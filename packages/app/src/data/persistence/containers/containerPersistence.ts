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
  localCreatedAt?: string | null;
  localUpdatedAt?: string | null;
  serverCreatedAt?: string | null;
  serverUpdatedAt?: string | null;
  updatedAt?: string | null;
}

export async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, containerTables);
  await ensureContainerTimestampColumns(execSql);
}

interface SelectedContainerRecord {
  id: string | null;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
  localCreatedAt: string;
  localUpdatedAt: string;
  serverCreatedAt: string | null;
  serverUpdatedAt: string | null;
}

function renderContainerSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function renderContainerTimestampExpression(
  columnNames: ReadonlyArray<string>,
): string {
  const columns = columnNames.map(renderContainerSqlIdentifier);
  return `COALESCE(${[...columns, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"].join(
    ", ",
  )})`;
}

async function ensureContainerTimestampColumns(
  execSql: ExecSql,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const existingColumns = new Set(
      (
        (await lockedExecSql(
          `PRAGMA table_info(${renderContainerSqlIdentifier("containers")})`,
        )) as Array<{ name?: unknown }>
      )
        .map((row) => row.name)
        .filter((name): name is string => typeof name === "string"),
    );
    const addColumn = async (columnName: string) => {
      if (existingColumns.has(columnName)) {
        return;
      }
      await lockedExecSql(
        `ALTER TABLE ${renderContainerSqlIdentifier(
          "containers",
        )} ADD COLUMN ${renderContainerSqlIdentifier(columnName)} TEXT`,
      );
      existingColumns.add(columnName);
    };

    await addColumn("created_at");
    await addColumn("updated_at");
    await addColumn("local_created_at");
    await addColumn("local_updated_at");
    await addColumn("server_created_at");
    await addColumn("server_updated_at");

    const legacyCreatedAt = existingColumns.has("created_at")
      ? ["created_at"]
      : [];
    const legacyUpdatedAt = existingColumns.has("updated_at")
      ? ["updated_at"]
      : [];

    await lockedExecSql(`
      UPDATE ${renderContainerSqlIdentifier("containers")}
      SET
        ${renderContainerSqlIdentifier(
          "local_created_at",
        )} = ${renderContainerTimestampExpression([
          "local_created_at",
          ...legacyCreatedAt,
          ...legacyUpdatedAt,
        ])},
        ${renderContainerSqlIdentifier(
          "local_updated_at",
        )} = ${renderContainerTimestampExpression([
          "local_updated_at",
          ...legacyUpdatedAt,
          ...legacyCreatedAt,
          "local_created_at",
        ])}
      WHERE ${renderContainerSqlIdentifier("local_created_at")} IS NULL
        OR ${renderContainerSqlIdentifier("local_updated_at")} IS NULL
    `);
  });
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
): ContainerRecord {
  const hasServerTimestamps =
    record.serverCreatedAt !== undefined ||
    record.serverUpdatedAt !== undefined;
  const localCreatedAt =
    record.localCreatedAt ??
    (!hasServerTimestamps ? record.createdAt : null) ??
    localUpdatedAt;

  return toDisplayContainerRecord({
    ...record,
    localCreatedAt,
    localUpdatedAt,
    serverCreatedAt: record.serverCreatedAt ?? null,
    serverUpdatedAt: record.serverUpdatedAt ?? null,
  });
}

function mapSelectedContainerRecord(
  row: SelectedContainerRecord,
): ContainerRecord {
  return toDisplayContainerRecord({
    id: String(row.id ?? ""),
    organizationId: row.organizationId,
    parentId: row.parentId,
    metadataDocumentId: row.metadataDocumentId,
    name: row.name,
    icon: row.icon && row.icon.length > 0 ? row.icon : null,
    localCreatedAt: row.localCreatedAt,
    localUpdatedAt: row.localUpdatedAt,
    serverCreatedAt: row.serverCreatedAt,
    serverUpdatedAt: row.serverUpdatedAt,
  });
}

export async function saveContainerRows(input: {
  tx: AppSQLiteTransaction;
  record: ContainerRecord;
  localUpdatedAt: string;
}): Promise<ContainerRecord> {
  const { record, tx, localUpdatedAt } = input;
  const nextRecord = applyContainerTimestampDefaults(record, localUpdatedAt);
  const containerRow = {
    id: nextRecord.id,
    organizationId: nextRecord.organizationId,
    parentId: nextRecord.parentId,
    metadataDocumentId: nextRecord.metadataDocumentId,
    legacyCreatedAt: nextRecord.localCreatedAt ?? localUpdatedAt,
    legacyUpdatedAt: localUpdatedAt,
    localCreatedAt: nextRecord.localCreatedAt ?? localUpdatedAt,
    localUpdatedAt,
    serverCreatedAt: nextRecord.serverCreatedAt ?? null,
    serverUpdatedAt: nextRecord.serverUpdatedAt ?? null,
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
        legacyUpdatedAt: containerRow.legacyUpdatedAt,
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

  const projectionRow = {
    containerId: nextRecord.id,
    displayName: nextRecord.name,
    icon: nextRecord.icon,
    updatedAt: localUpdatedAt,
  };
  await tx
    .insert(containerProjection)
    .values(projectionRow)
    .onConflictDoUpdate({
      target: containerProjection.containerId,
      set: projectionRow,
    })
    .run();

  return nextRecord;
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
      localCreatedAt: containers.localCreatedAt,
      localUpdatedAt: containers.localUpdatedAt,
      serverCreatedAt: containers.serverCreatedAt,
      serverUpdatedAt: containers.serverUpdatedAt,
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
  const localUpdatedAt = new Date().toISOString();

  await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
    await saveContainerRows({
      record,
      tx,
      localUpdatedAt,
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
