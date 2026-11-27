import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  buildProductionTokenIndex,
  isReferencedOutside,
  stripTsComments,
  walkFiles,
} from "./fileWalk";
import {
  type DuplicateIndexLead,
  findLeftPrefixDuplicateIndexes,
  type TableIndex,
} from "./indexes";

export interface ParsedSqliteTable {
  readonly exportName: string;
  readonly sqlTable: string;
  readonly file: string;
  readonly scope: "sdk" | "app-projection";
  readonly columns: ReadonlyMap<string, string>;
  readonly indexes: readonly TableIndex[];
}

export interface SqliteUnreadColumnLead {
  readonly table: string;
  readonly sqlColumn: string;
  readonly propertyName: string;
  readonly scope: "sdk" | "app-projection";
}

export interface SqliteSchemaInventory {
  readonly sdkTableCount: number;
  readonly appProjectionTableCount: number;
  readonly totalTableCount: number;
  readonly columnCount: number;
  readonly indexCount: number;
  readonly tables: readonly string[];
  readonly duplicateIndexes: readonly DuplicateIndexLead[];
  readonly unreadTables: readonly string[];
  readonly unreadColumns: readonly SqliteUnreadColumnLead[];
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) {
    if (match[1] && match[2]) {
      constants.set(match[1], match[2]);
    }
  }
  return constants;
}

function resolveNameToken(
  token: string,
  constants: ReadonlyMap<string, string>,
): string {
  const trimmed = token.trim();
  const quoted = /^["']([^"']+)["']$/u.exec(trimmed);
  if (quoted?.[1]) return quoted[1];
  return constants.get(trimmed) ?? trimmed;
}

function parseSqliteColumns(
  block: string,
  tableName: string,
  constants: ReadonlyMap<string, string>,
): {
  readonly columns: Map<string, string>;
  readonly inlineIndexes: TableIndex[];
} {
  const columns = new Map<string, string>();
  const inlineIndexes: TableIndex[] = [];
  const entries = splitTopLevelEntries(block);
  const entryPattern =
    /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*([^,)]+)/u;

  for (const entry of entries) {
    const trimmed = entry.trim();
    const match = entryPattern.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;
    const propertyName = match[1];
    const sqlColumn = resolveNameToken(match[2], constants);
    columns.set(propertyName, sqlColumn);
    if (/\.primaryKey\s*\(/u.test(trimmed)) {
      inlineIndexes.push({
        name: `${tableName}_pkey`,
        table: tableName,
        columns: [sqlColumn],
        unique: true,
        primaryKey: true,
        predicate: null,
      });
    }
    if (/\.unique\s*\(/u.test(trimmed)) {
      inlineIndexes.push({
        name: `${tableName}_${sqlColumn}_unique`,
        table: tableName,
        columns: [sqlColumn],
        unique: true,
        primaryKey: false,
        predicate: null,
      });
    }
  }
  return { columns, inlineIndexes };
}

function splitTopLevelEntries(block: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      entries.push(block.slice(start, i));
      start = i + 1;
    }
  }
  if (start < block.length) entries.push(block.slice(start));
  return entries;
}

function extractTableColumnRefs(
  raw: string,
  columns: ReadonlyMap<string, string>,
): string[] {
  const refs: string[] = [];
  for (const match of raw.matchAll(
    /[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_][A-Za-z0-9_]*)/gu,
  )) {
    const prop = match[1];
    if (!prop) continue;
    refs.push(columns.get(prop) ?? prop);
  }
  return refs;
}

function parseExtraConfigIndexes(
  extraText: string,
  tableName: string,
  columns: ReadonlyMap<string, string>,
): TableIndex[] {
  const indexes: TableIndex[] = [];
  const pkMatch = /primaryKey\s*\(\s*\{\s*columns\s*:\s*\[([^\]]+)\]/u.exec(
    extraText,
  );
  if (pkMatch?.[1]) {
    const pkCols = extractTableColumnRefs(pkMatch[1], columns);
    if (pkCols.length > 0) {
      indexes.push({
        name: `${tableName}_pkey`,
        table: tableName,
        columns: pkCols,
        unique: true,
        primaryKey: true,
        predicate: null,
      });
    }
  }

  const idxPattern =
    /\b(uniqueIndex|index)\s*\(\s*["']([^"']+)["']\s*\)\s*\.on\s*\(([^)]+)\)(?:\s*\.where\s*\(([\s\S]*?)\))?/gu;
  for (const match of extraText.matchAll(idxPattern)) {
    const kind = match[1];
    const name = match[2];
    const colsRaw = match[3];
    if (!kind || !name || !colsRaw) continue;
    const idxCols = extractTableColumnRefs(colsRaw, columns);
    if (idxCols.length === 0) continue;
    indexes.push({
      name,
      table: tableName,
      columns: idxCols,
      unique: kind === "uniqueIndex",
      primaryKey: false,
      predicate: match[4]?.trim() ?? null,
    });
  }
  return indexes;
}

export function parseSqliteTablesFromSource(
  source: string,
  file: string,
  scope: "sdk" | "app-projection",
): ParsedSqliteTable[] {
  const stripped = stripTsComments(source);
  const constants = collectStringConstants(stripped);
  const tables: ParsedSqliteTable[] = [];
  const pattern =
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*sqliteTable\s*\(\s*([^,]+),\s*\{/gu;

  for (const match of stripped.matchAll(pattern)) {
    const exportName = match[1];
    const rawTableName = match[2];
    if (!exportName || !rawTableName || match.index === undefined) continue;
    const callOpen = stripped.indexOf("(", match.index);
    const callClose = findMatchingDelimiter(stripped, callOpen, "(", ")");
    const columnsOpen = match.index + match[0].length - 1;
    const columnsClose = findMatchingDelimiter(stripped, columnsOpen, "{", "}");
    if (callClose === -1 || columnsClose === -1) continue;

    const sqlTable = resolveNameToken(rawTableName, constants);
    const { columns, inlineIndexes } = parseSqliteColumns(
      stripped.slice(columnsOpen + 1, columnsClose),
      sqlTable,
      constants,
    );
    const extraText = stripped.slice(columnsClose + 1, callClose);
    const extraIndexes = parseExtraConfigIndexes(extraText, sqlTable, columns);

    tables.push({
      exportName,
      sqlTable,
      file,
      scope,
      columns,
      indexes: [...inlineIndexes, ...extraIndexes],
    });
  }
  return tables;
}

async function loadSqliteTables(
  repoRoot: string,
  directory: string,
  scope: "sdk" | "app-projection",
): Promise<{ readonly tables: ParsedSqliteTable[]; readonly files: string[] }> {
  const files = await walkFiles(
    directory,
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );
  const tables: ParsedSqliteTable[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    tables.push(
      ...parseSqliteTablesFromSource(source, relative(repoRoot, file), scope),
    );
  }
  return { tables, files };
}

export async function auditSqliteSchema(
  repoRoot: string,
): Promise<SqliteSchemaInventory> {
  const sdkSchemaDir = join(
    repoRoot,
    "packages/client-sdk/src/data/sqlite/schema",
  );
  const appProjectorsDir = join(
    repoRoot,
    "packages/app/src/document-projectors",
  );
  const [sdkLoaded, appLoaded] = await Promise.all([
    loadSqliteTables(repoRoot, sdkSchemaDir, "sdk"),
    loadSqliteTables(repoRoot, appProjectorsDir, "app-projection"),
  ]);

  const allTables = [...sdkLoaded.tables, ...appLoaded.tables].sort((a, b) =>
    a.sqlTable.localeCompare(b.sqlTable),
  );
  const excludedSchemaFiles = new Set(allTables.map((table) => table.file));
  const tokenIndex = await buildProductionTokenIndex(
    repoRoot,
    [
      join(repoRoot, "packages/client-sdk/src"),
      join(repoRoot, "packages/app/src"),
      join(repoRoot, "packages/cli/src"),
    ],
    excludedSchemaFiles,
  );

  const indexesByTable = new Map<string, readonly TableIndex[]>();
  const unreadTables: string[] = [];
  const unreadColumns: SqliteUnreadColumnLead[] = [];
  let columnCount = 0;
  let indexCount = 0;

  for (const table of allTables) {
    columnCount += table.columns.size;
    indexCount += table.indexes.length;
    indexesByTable.set(table.sqlTable, table.indexes);

    if (!isReferencedOutside(tokenIndex, [table.exportName, table.sqlTable])) {
      unreadTables.push(table.sqlTable);
      continue;
    }
    for (const [propertyName, sqlColumn] of table.columns) {
      if (!isReferencedOutside(tokenIndex, [propertyName, sqlColumn])) {
        unreadColumns.push({
          table: table.sqlTable,
          sqlColumn,
          propertyName,
          scope: table.scope,
        });
      }
    }
  }

  return {
    sdkTableCount: sdkLoaded.tables.length,
    appProjectionTableCount: appLoaded.tables.length,
    totalTableCount: allTables.length,
    columnCount,
    indexCount,
    tables: allTables.map((table) => table.sqlTable),
    duplicateIndexes: findLeftPrefixDuplicateIndexes(indexesByTable),
    unreadTables,
    unreadColumns,
  };
}
