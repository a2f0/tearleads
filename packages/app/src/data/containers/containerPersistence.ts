import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlRow,
  type SqlTableSchema,
} from "../persistence/sqlSchema";

export interface ContainerRecord {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string | null;
  name: string;
  icon: string | null;
}

const containerTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "containers",
    createSql: `
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        parent_id TEXT,
        metadata_document_id TEXT,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    name: "container_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS container_projection (
        container_id TEXT PRIMARY KEY,
        display_name TEXT,
        icon TEXT,
        updated_at TEXT NOT NULL
      )
    `,
  },
];

export async function ensureContainerTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, containerTables);
}

function parseContainerRecord(row: SqlRow): ContainerRecord {
  const id = readSqlRowValue(row, "id");
  const organizationId = readSqlRowValue(row, "organization_id");
  const parentId = readSqlRowValue(row, "parent_id");
  const metadataDocumentId = readSqlRowValue(row, "metadata_document_id");
  const name = readSqlRowValue(row, "name");
  const icon = readSqlRowValue(row, "icon");

  return {
    id: String(id ?? ""),
    organizationId: String(organizationId ?? ""),
    parentId:
      parentId === null || parentId === undefined ? null : String(parentId),
    metadataDocumentId:
      metadataDocumentId === null || metadataDocumentId === undefined
        ? null
        : String(metadataDocumentId),
    name: String(name ?? ""),
    icon:
      icon === null || icon === undefined || String(icon).length === 0
        ? null
        : String(icon),
  };
}

export async function loadContainers(
  execSql: ExecSql,
): Promise<ContainerRecord[]> {
  const rows = await execSql(
    `
      SELECT
        containers.id,
        containers.organization_id,
        containers.parent_id,
        containers.metadata_document_id,
        COALESCE(
          projection.display_name,
          CASE
            WHEN containers.parent_id IS NULL THEN '/'
            ELSE 'Untitled'
          END
        ) AS name,
        projection.icon
      FROM containers
      LEFT JOIN container_projection AS projection
        ON projection.container_id = containers.id
      ORDER BY name COLLATE NOCASE ASC
    `,
  );

  return rows.map((row) => parseContainerRecord(row));
}

export async function saveContainer(
  execSql: ExecSql,
  record: ContainerRecord,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    const updatedAt = new Date().toISOString();

    await runSqlTransaction(lockedExecSql, async () => {
      await lockedExecSql(
        `
          INSERT INTO containers (
            id,
            organization_id,
            parent_id,
            metadata_document_id,
            updated_at
          )
          VALUES (
            :id,
            :organizationId,
            :parentId,
            :metadataDocumentId,
            :updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            organization_id = excluded.organization_id,
            parent_id = excluded.parent_id,
            metadata_document_id = excluded.metadata_document_id,
            updated_at = excluded.updated_at
        `,
        {
          ":id": record.id,
          ":organizationId": record.organizationId,
          ":parentId": record.parentId,
          ":metadataDocumentId": record.metadataDocumentId,
          ":updatedAt": updatedAt,
        },
      );

      await lockedExecSql(
        `
          INSERT INTO container_projection (
            container_id,
            display_name,
            icon,
            updated_at
          )
          VALUES (
            :id,
            :name,
            :icon,
            :updatedAt
          )
          ON CONFLICT(container_id) DO UPDATE SET
            display_name = excluded.display_name,
            icon = excluded.icon,
            updated_at = excluded.updated_at
        `,
        {
          ":id": record.id,
          ":name": record.name,
          ":icon": record.icon,
          ":updatedAt": updatedAt,
        },
      );
    });
  });
}

export async function deleteContainer(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await runSqlTransaction(lockedExecSql, async () => {
      await lockedExecSql(
        `
          DELETE FROM container_projection
          WHERE container_id = :id
        `,
        {
          ":id": id,
        },
      );
      await lockedExecSql(
        `
          DELETE FROM containers
          WHERE id = :id
        `,
        {
          ":id": id,
        },
      );
    });
  });
}
