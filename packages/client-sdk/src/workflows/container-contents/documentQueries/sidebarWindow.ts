import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { getOrphanedDocumentQueryBind } from "./orphanedDocumentSql";
import {
  mapContainerDocumentSidebarRow,
  readContainerContentsContainerItemCount,
} from "./rows";
import {
  clampContainerItemWindowValue,
  getContainerContentsContainerDocumentSidebarOrderBy,
  getContainerContentsDocumentRowsBaseSql,
  getContainerDocumentSidebarWindowLimit,
  getOrphanedDocumentRowsBaseSql,
} from "./sql";
import type { ContainerDocumentSidebarWindow } from "./types";

export async function listContainerDocumentSidebarWindow(
  execSql: ExecSql,
  input: {
    containerId: string | null;
    currentOrganizationId?: string | null | undefined;
    documentKind?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<ContainerDocumentSidebarWindow> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const limit = getContainerDocumentSidebarWindowLimit(input.limit);
  const offset = clampContainerItemWindowValue(input.offset);
  const orphaned = input.containerId === null;
  const bind = [
    ...(orphaned
      ? getOrphanedDocumentQueryBind(input.currentOrganizationId)
      : [input.containerId, input.containerId]),
  ];
  const rowsSql = orphaned
    ? getOrphanedDocumentRowsBaseSql()
    : getContainerContentsDocumentRowsBaseSql();
  const baseSql =
    input.documentKind === undefined
      ? rowsSql
      : `SELECT * FROM (${rowsSql}) WHERE document_kind = ?`;
  if (input.documentKind !== undefined) bind.push(input.documentKind);
  const countRows = await execSql(
    `SELECT COUNT(*) AS total_count FROM (${baseSql})`,
    bind,
  );
  const totalCount = readContainerContentsContainerItemCount(
    countRows[0] ?? {},
  );

  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const rows = await execSql(
    `${baseSql} ORDER BY ${getContainerContentsContainerDocumentSidebarOrderBy()} LIMIT ? OFFSET ?`,
    [...bind, limit, offset],
  );

  return {
    rows: rows.map(mapContainerDocumentSidebarRow),
    totalCount,
  };
}
