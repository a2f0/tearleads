import {
  assertRestorableLocalSchemaLedger,
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
} from "@tearleads/client-sdk/sqlite";
import type { BackupIndex, BackupTable } from "./localBackupFormat";
import { validatePrincipalIdentityBackupTable } from "./principalBackupValidation";

interface SqlToken {
  readonly value: string;
  readonly quoted: boolean;
}

function invalidSchema(): never {
  throw new Error(
    "Backup schema must contain only its declared CREATE statement.",
  );
}

function readQuotedToken(
  sql: string,
  start: number,
  quote: string,
): {
  readonly token: SqlToken;
  readonly end: number;
} {
  const endQuote = quote === "[" ? "]" : quote;
  let value = "";
  let offset = start + 1;
  while (offset < sql.length) {
    const next = sql[offset];
    offset += 1;
    if (next !== endQuote) {
      value += next;
    } else if (quote !== "[" && sql[offset] === endQuote) {
      value += endQuote;
      offset += 1;
    } else {
      return { token: { value, quoted: true }, end: offset };
    }
  }
  return invalidSchema();
}

/** The offset after whitespace or a comment at `offset`, else null. */
function skipWhitespaceOrComment(sql: string, offset: number): number | null {
  if (/\s/.test(sql.charAt(offset))) return offset + 1;
  if (sql.startsWith("--", offset)) {
    const end = sql.indexOf("\n", offset + 2);
    return end < 0 ? sql.length : end + 1;
  }
  if (sql.startsWith("/*", offset)) {
    const end = sql.indexOf("*/", offset + 2);
    if (end < 0) invalidSchema();
    return end + 2;
  }
  return null;
}

// Read SQLite quoting and comments before checking statement boundaries. A
// semicolon inside a quoted identifier or default value is ordinary data.
function schemaTokens(sql: string): SqlToken[] {
  if (sql.includes("\0")) invalidSchema();
  const tokens: SqlToken[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const skipped = skipWhitespaceOrComment(sql, offset);
    if (skipped !== null) {
      offset = skipped;
      continue;
    }
    const character = sql.charAt(offset);
    if (["'", '"', "`", "["].includes(character)) {
      const quoted = readQuotedToken(sql, offset, character);
      tokens.push(quoted.token);
      offset = quoted.end;
    } else {
      const word = /^[\p{L}\p{N}_$]+/u.exec(sql.slice(offset))?.[0];
      tokens.push({ value: word ?? character, quoted: false });
      offset += word?.length ?? 1;
    }
  }
  return tokens;
}

function validateCreateStatement(input: {
  readonly kind: "TABLE" | "INDEX";
  readonly name: string;
  readonly sql: string;
  readonly tableName?: string;
}): SqlToken[] {
  const tokens = schemaTokens(input.sql);
  const last = tokens.at(-1);
  if (last?.value === ";" && !last.quoted) tokens.pop();
  if (tokens.some((token) => token.value === ";" && !token.quoted)) {
    invalidSchema();
  }
  let offset = 0;
  const consume = (keyword: string): boolean => {
    const token = tokens[offset];
    if (token?.quoted || token?.value.toUpperCase() !== keyword) return false;
    offset += 1;
    return true;
  };
  const requireKeyword = (keyword: string): void => {
    if (!consume(keyword)) invalidSchema();
  };
  const requireName = (name: string): void => {
    if (tokens[offset]?.value !== name) invalidSchema();
    offset += 1;
  };

  requireKeyword("CREATE");
  if (input.kind === "INDEX") consume("UNIQUE");
  requireKeyword(input.kind);
  if (consume("IF")) {
    requireKeyword("NOT");
    requireKeyword("EXISTS");
  }
  requireName(input.name);
  if (input.tableName !== undefined) {
    requireKeyword("ON");
    requireName(input.tableName);
  }
  requireKeyword("(");
  return tokens.slice(offset);
}

function isSqlSymbol(token: SqlToken, value: string): boolean {
  return !token.quoted && token.value === value;
}

function declaredTableColumns(tokens: readonly SqlToken[]): string[] {
  const columns: string[] = [];
  const constraints = new Set([
    "CONSTRAINT",
    "PRIMARY",
    "UNIQUE",
    "CHECK",
    "FOREIGN",
  ]);
  let depth = 1;
  let startsColumn = true;
  for (const token of tokens) {
    if (isSqlSymbol(token, ")")) {
      depth -= 1;
      if (depth === 0) return columns;
    } else if (isSqlSymbol(token, "(")) depth += 1;
    if (
      startsColumn &&
      (token.quoted || !constraints.has(token.value.toUpperCase()))
    )
      columns.push(token.value);
    startsColumn = depth === 1 && isSqlSymbol(token, ",");
  }
  return invalidSchema();
}

// A database names each table and index once. A repeated name would let a
// later `CREATE ... IF NOT EXISTS` entry add rows the checks below never read.
function assertUniqueNames(
  entries: ReadonlyArray<{ readonly name: string }>,
  kind: "table" | "index",
): void {
  const seen = new Set<string>();
  for (const { name } of entries) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Backup schema lists ${kind} ${name} more than once.`);
    }
    seen.add(key);
  }
}

/**
 * Also refuses a backup whose local schema ledger this build cannot open (a
 * newer app's backup) before the restore writes anything. An older backup
 * restores as is: the next table ensure migrates it to this build's version.
 */
export function validateBackupSchema(input: {
  readonly indexes: ReadonlyArray<BackupIndex>;
  readonly tables: ReadonlyArray<BackupTable>;
}): void {
  assertUniqueNames(input.tables, "table");
  assertUniqueNames(input.indexes, "index");
  assertRestorableLocalSchemaLedger(
    input.tables.find(({ name }) => name === LOCAL_SCHEMA_MIGRATIONS_TABLE)
      ?.rows ?? [],
  );
  for (const table of input.tables) {
    const body = validateCreateStatement({ ...table, kind: "TABLE" });
    validatePrincipalIdentityBackupTable(table, () =>
      declaredTableColumns(body),
    );
  }
  for (const index of input.indexes) {
    validateCreateStatement({ ...index, kind: "INDEX" });
  }
}
