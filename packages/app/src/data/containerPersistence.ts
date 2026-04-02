import type { SqlRow } from "./AppDataProvider";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  type SqlTableSchema,
} from "./sqlSchema";

export interface ContainerRecord {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
}

const containerTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "containers",
    createSql: `
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
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
  const name = readSqlRowValue(row, "name");

  return {
    id: String(id ?? ""),
    organizationId: String(organizationId ?? ""),
    parentId:
      parentId === null || parentId === undefined ? null : String(parentId),
    name: String(name ?? ""),
  };
}

export async function loadContainers(
  execSql: ExecSql,
): Promise<ContainerRecord[]> {
  const rows = await execSql(
    `
      SELECT id, organization_id, parent_id, name
      FROM containers
      ORDER BY name COLLATE NOCASE ASC
    `,
  );

  return rows.map((row) => parseContainerRecord(row));
}

export async function saveContainer(
  execSql: ExecSql,
  record: ContainerRecord,
): Promise<void> {
  await execSql(
    `
      INSERT INTO containers (id, organization_id, parent_id, name, updated_at)
      VALUES (:id, :organizationId, :parentId, :name, :updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        organization_id = excluded.organization_id,
        parent_id = excluded.parent_id,
        name = excluded.name,
        updated_at = excluded.updated_at
    `,
    {
      ":id": record.id,
      ":organizationId": record.organizationId,
      ":parentId": record.parentId,
      ":name": record.name,
      ":updatedAt": new Date().toISOString(),
    },
  );
}
