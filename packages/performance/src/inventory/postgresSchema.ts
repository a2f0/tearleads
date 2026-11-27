import { readdir, readFile } from "node:fs/promises";
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

interface MutableTable {
  readonly name: string;
  readonly columns: Set<string>;
  readonly indexes: Map<string, TableIndex>;
}

export interface DrizzleTableMapping {
  readonly sqlTable: string;
  readonly exportName: string;
  readonly file: string;
  readonly columns: ReadonlyMap<string, string>;
}

export interface UnreadColumnLead {
  readonly table: string;
  readonly sqlColumn: string;
  readonly propertyName?: string;
}

export interface PostgresSchemaInventory {
  readonly migrationCount: number;
  readonly tableCount: number;
  readonly columnCount: number;
  readonly indexCount: number;
  readonly tables: readonly string[];
  readonly duplicateIndexes: readonly DuplicateIndexLead[];
  readonly unreadTables: readonly string[];
  readonly unreadColumns: readonly UnreadColumnLead[];
}

function unquoteIdentifier(raw: string): string {
  return raw.trim().replace(/^"(.*)"$/u, "$1");
}

function parseQuotedList(raw: string): string[] {
  const columns: string[] = [];
  for (const part of raw.split(",")) {
    const match = /"([^"]+)"/u.exec(part);
    if (match?.[1]) {
      columns.push(match[1]);
    } else {
      const trimmed = part.trim().split(/\s+/u)[0];
      if (trimmed) columns.push(unquoteIdentifier(trimmed));
    }
  }
  return columns;
}

function splitTopLevelSqlEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      entries.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (start < body.length) entries.push(body.slice(start));
  return entries;
}

function parseCreateTable(
  statement: string,
  tables: Map<string, MutableTable>,
): void {
  const head =
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s*\(/iu.exec(
      statement,
    );
  if (!head?.[1]) return;
  const tableName = head[1];
  const openIndex = statement.indexOf("(");
  const closeIndex = statement.lastIndexOf(")");
  if (openIndex === -1 || closeIndex <= openIndex) return;
  const body = statement.slice(openIndex + 1, closeIndex);
  const table: MutableTable = {
    name: tableName,
    columns: new Set(),
    indexes: new Map(),
  };
  for (const rawEntry of splitTopLevelSqlEntries(body)) {
    parseTableBodyLine(rawEntry.trim(), table);
  }
  tables.set(tableName, table);
}

function parseTableBodyLine(line: string, table: MutableTable): void {
  if (!line) return;
  const cleaned = line.replace(/,\s*$/u, "");
  const constraintUnique =
    /^CONSTRAINT\s+"([^"]+)"\s+UNIQUE\s*\(([^)]+)\)/iu.exec(cleaned);
  if (constraintUnique?.[1] && constraintUnique[2]) {
    table.indexes.set(constraintUnique[1], {
      name: constraintUnique[1],
      table: table.name,
      columns: parseQuotedList(constraintUnique[2]),
      unique: true,
      primaryKey: false,
      predicate: null,
    });
    return;
  }
  const constraintPk =
    /^(?:CONSTRAINT\s+"([^"]+)"\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/iu.exec(
      cleaned,
    );
  if (constraintPk?.[2]) {
    const pkName = constraintPk[1] ?? `${table.name}_pkey`;
    table.indexes.set(pkName, {
      name: pkName,
      table: table.name,
      columns: parseQuotedList(constraintPk[2]),
      unique: true,
      primaryKey: true,
      predicate: null,
    });
    return;
  }
  if (/^CONSTRAINT\s+/iu.test(cleaned)) return;
  const columnMatch = /^"([^"]+)"\s+/u.exec(cleaned);
  if (!columnMatch?.[1]) return;
  const columnName = columnMatch[1];
  table.columns.add(columnName);
  if (/\bPRIMARY\s+KEY\b/iu.test(cleaned)) {
    const pkName = `${table.name}_pkey`;
    table.indexes.set(pkName, {
      name: pkName,
      table: table.name,
      columns: [columnName],
      unique: true,
      primaryKey: true,
      predicate: null,
    });
  }
  if (/\bUNIQUE\b/iu.test(cleaned)) {
    const uniqueName = `${table.name}_${columnName}_unique`;
    table.indexes.set(uniqueName, {
      name: uniqueName,
      table: table.name,
      columns: [columnName],
      unique: true,
      primaryKey: false,
      predicate: null,
    });
  }
}

function parseAlterTable(
  statement: string,
  tables: Map<string, MutableTable>,
): void {
  const tableMatch = /^ALTER\s+TABLE\s+"([^"]+)"\s+([\s\S]+)$/iu.exec(
    statement,
  );
  if (!tableMatch?.[1] || !tableMatch[2]) return;
  const table = tables.get(tableMatch[1]);
  if (!table) return;
  const rest = tableMatch[2].trim();

  const addCol = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/iu.exec(
    rest,
  );
  if (addCol?.[1]) {
    table.columns.add(addCol[1]);
    return;
  }
  const dropCol = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(rest);
  if (dropCol?.[1]) {
    table.columns.delete(dropCol[1]);
    return;
  }
  const addUnique =
    /^ADD\s+CONSTRAINT\s+"([^"]+)"\s+UNIQUE\s*\(([^)]+)\)/iu.exec(rest);
  if (addUnique?.[1] && addUnique[2]) {
    table.indexes.set(addUnique[1], {
      name: addUnique[1],
      table: table.name,
      columns: parseQuotedList(addUnique[2]),
      unique: true,
      primaryKey: false,
      predicate: null,
    });
    return;
  }
  const dropConstraint =
    /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(rest);
  if (dropConstraint?.[1]) {
    table.indexes.delete(dropConstraint[1]);
  }
}

function parseCreateIndex(
  statement: string,
  tables: Map<string, MutableTable>,
): void {
  const match =
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"\s+(?:USING\s+\w+\s+)?\(([^)]+)\)(?:\s+WHERE\s+([\s\S]+))?$/iu.exec(
      statement,
    );
  if (!match?.[2] || !match[3] || !match[4]) return;
  const table = tables.get(match[3]);
  if (!table) return;
  table.indexes.set(match[2], {
    name: match[2],
    table: table.name,
    columns: parseQuotedList(match[4]),
    unique: match[1] !== undefined,
    primaryKey: false,
    predicate: match[5]?.trim() ?? null,
  });
}

function parseDropIndex(
  statement: string,
  tables: Map<string, MutableTable>,
): void {
  const match = /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(
    statement,
  );
  if (!match?.[1]) return;
  for (const table of tables.values()) {
    table.indexes.delete(match[1]);
  }
}

function parseDropTable(
  statement: string,
  tables: Map<string, MutableTable>,
): void {
  const match = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(
    statement,
  );
  if (match?.[1]) {
    tables.delete(match[1]);
  }
}

function stripSqlLineComments(sqlText: string): string {
  return sqlText
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function applyMigrationSql(
  sqlText: string,
  tables: Map<string, MutableTable>,
): void {
  const chunks = sqlText.split("--> statement-breakpoint");
  for (const rawChunk of chunks) {
    const cleaned = stripSqlLineComments(rawChunk).trim().replace(/;\s*$/u, "");
    if (!cleaned) continue;
    if (/^CREATE\s+TABLE\b/iu.test(cleaned)) {
      parseCreateTable(cleaned, tables);
    } else if (/^ALTER\s+TABLE\b/iu.test(cleaned)) {
      parseAlterTable(cleaned, tables);
    } else if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(cleaned)) {
      parseCreateIndex(cleaned, tables);
    } else if (/^DROP\s+INDEX\b/iu.test(cleaned)) {
      parseDropIndex(cleaned, tables);
    } else if (/^DROP\s+TABLE\b/iu.test(cleaned)) {
      parseDropTable(cleaned, tables);
    }
  }
}

export async function parsePostgresMigrations(migrationsDir: string): Promise<{
  readonly migrationCount: number;
  readonly tables: ReadonlyMap<
    string,
    {
      readonly name: string;
      readonly columns: readonly string[];
      readonly indexes: readonly TableIndex[];
    }
  >;
}> {
  let entries: string[];
  try {
    entries = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    return { migrationCount: 0, tables: new Map() };
  }
  const tables = new Map<string, MutableTable>();
  for (const fileName of entries) {
    const sqlText = await readFile(join(migrationsDir, fileName), "utf8");
    applyMigrationSql(sqlText, tables);
  }
  const finalized = new Map<
    string,
    {
      readonly name: string;
      readonly columns: readonly string[];
      readonly indexes: readonly TableIndex[];
    }
  >();
  for (const [name, table] of [...tables.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    finalized.set(name, {
      name,
      columns: [...table.columns].sort(),
      indexes: [...table.indexes.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    });
  }
  return { migrationCount: entries.length, tables: finalized };
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseColumnsBlock(block: string): Map<string, string> {
  const columns = new Map<string, string>();
  const propPattern =
    /(?:^|[,{\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*["']([^"']+)["']/gu;
  for (const match of block.matchAll(propPattern)) {
    if (match[1] && match[2]) {
      columns.set(match[2], match[1]);
    }
  }
  return columns;
}

async function parseDrizzlePgSchemaMap(
  repoRoot: string,
  schemaDirs: readonly string[],
): Promise<ReadonlyMap<string, DrizzleTableMapping>> {
  const files: string[] = [];
  for (const dir of schemaDirs) {
    files.push(...(await walkFiles(dir, (file) => file.endsWith(".ts"))));
  }
  const mappings = new Map<string, DrizzleTableMapping>();
  const tableHeader =
    /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*pgTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/gu;

  for (const file of files) {
    const source = stripTsComments(await readFile(file, "utf8"));
    const rel = relative(repoRoot, file);
    for (const match of source.matchAll(tableHeader)) {
      const exportName = match[1];
      const sqlTable = match[2];
      if (!exportName || !sqlTable || match.index === undefined) continue;
      const openBrace = match.index + match[0].length - 1;
      const closeBrace = findMatchingBrace(source, openBrace);
      if (closeBrace === -1) continue;
      const columns = parseColumnsBlock(
        source.slice(openBrace + 1, closeBrace),
      );
      mappings.set(sqlTable, { sqlTable, exportName, file: rel, columns });
    }
  }
  return mappings;
}

function findUnreadTableColumns(
  tableName: string,
  columns: readonly string[],
  mapping: DrizzleTableMapping | undefined,
  tokenIndex: Awaited<ReturnType<typeof buildProductionTokenIndex>>,
): UnreadColumnLead[] {
  const unread: UnreadColumnLead[] = [];
  for (const sqlColumn of columns) {
    const propertyName = mapping?.columns.get(sqlColumn);
    const columnTokens = propertyName ? [propertyName, sqlColumn] : [sqlColumn];
    if (isReferencedOutside(tokenIndex, columnTokens)) continue;
    unread.push(
      propertyName !== undefined
        ? { table: tableName, sqlColumn, propertyName }
        : { table: tableName, sqlColumn },
    );
  }
  return unread;
}

export async function auditPostgresSchema(
  repoRoot: string,
): Promise<PostgresSchemaInventory> {
  const migrationsDir = join(repoRoot, "packages/api-shared/drizzle");
  const schemaDirs = [
    join(repoRoot, "packages/api-shared/src/schema"),
    join(repoRoot, "packages/loro/src/server"),
  ];
  const [{ migrationCount, tables }, drizzleMap] = await Promise.all([
    parsePostgresMigrations(migrationsDir),
    parseDrizzlePgSchemaMap(repoRoot, schemaDirs),
  ]);

  const schemaFiles = new Set(
    [...drizzleMap.values()].map((mapping) => mapping.file),
  );
  const tokenIndex = await buildProductionTokenIndex(
    repoRoot,
    [
      join(repoRoot, "packages/api/src"),
      join(repoRoot, "packages/api-shared/src"),
      join(repoRoot, "packages/api-cli/src"),
      join(repoRoot, "packages/loro/src"),
    ],
    schemaFiles,
  );

  const indexesByTable = new Map<string, readonly TableIndex[]>();
  const unreadTables: string[] = [];
  const unreadColumns: UnreadColumnLead[] = [];
  let columnCount = 0;
  let indexCount = 0;

  for (const [tableName, table] of tables) {
    columnCount += table.columns.length;
    indexCount += table.indexes.length;
    indexesByTable.set(tableName, table.indexes);

    const mapping = drizzleMap.get(tableName);
    const tableTokens = mapping ? [mapping.exportName, tableName] : [tableName];
    if (!isReferencedOutside(tokenIndex, tableTokens)) {
      unreadTables.push(tableName);
      continue;
    }
    unreadColumns.push(
      ...findUnreadTableColumns(tableName, table.columns, mapping, tokenIndex),
    );
  }

  return {
    migrationCount,
    tableCount: tables.size,
    columnCount,
    indexCount,
    tables: [...tables.keys()],
    duplicateIndexes: findLeftPrefixDuplicateIndexes(indexesByTable),
    unreadTables,
    unreadColumns,
  };
}
