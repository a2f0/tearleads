import type { BackupIndex, BackupTable } from "./localBackupFormat";

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

// Read SQLite quoting and comments before checking statement boundaries. A
// semicolon inside a quoted identifier or default value is ordinary data.
function schemaTokens(sql: string): SqlToken[] {
  if (sql.includes("\0")) invalidSchema();
  const tokens: SqlToken[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const character = sql.charAt(offset);
    if (/\s/.test(character)) {
      offset += 1;
    } else if (sql.startsWith("--", offset)) {
      const end = sql.indexOf("\n", offset + 2);
      offset = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", offset)) {
      const end = sql.indexOf("*/", offset + 2);
      if (end < 0) invalidSchema();
      offset = end + 2;
    } else if (["'", '"', "`", "["].includes(character)) {
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
}): void {
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
}

export function validateBackupSchema(input: {
  readonly indexes: ReadonlyArray<BackupIndex>;
  readonly tables: ReadonlyArray<BackupTable>;
}): void {
  for (const table of input.tables) {
    validateCreateStatement({ ...table, kind: "TABLE" });
  }
  for (const index of input.indexes) {
    validateCreateStatement({ ...index, kind: "INDEX" });
  }
}
