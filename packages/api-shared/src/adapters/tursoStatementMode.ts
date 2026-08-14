const rootStatementKeywords = new Set([
  "DELETE",
  "INSERT",
  "REPLACE",
  "SELECT",
  "UPDATE",
]);

function skipQuotedSql(sql: string, start: number, closing: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== closing) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === closing) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return index;
}

function sqlCommentEnd(sql: string, index: number): number | undefined {
  if (sql.startsWith("--", index)) {
    const newline = sql.indexOf("\n", index + 2);
    return newline === -1 ? sql.length : newline + 1;
  }
  if (sql.startsWith("/*", index)) {
    const closing = sql.indexOf("*/", index + 2);
    return closing === -1 ? sql.length : closing + 2;
  }
  return undefined;
}

function sqlQuoteEnd(sql: string, index: number): number | undefined {
  const character = sql[index];
  if (character === "[") {
    return skipQuotedSql(sql, index, "]");
  }
  if (character === "'" || character === '"' || character === "`") {
    return skipQuotedSql(sql, index, character);
  }
  return undefined;
}

function sqlKeywordEnd(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length && /[A-Za-z0-9_$]/u.test(sql[index] ?? "")) {
    index += 1;
  }
  return index;
}

function topLevelKeywords(sql: string): string[] {
  const keywords: string[] = [];
  let depth = 0;
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];
    const commentEnd = sqlCommentEnd(sql, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    const quoteEnd = sqlQuoteEnd(sql, index);
    if (quoteEnd !== undefined) {
      index = quoteEnd;
      continue;
    }
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (character !== undefined && /[A-Za-z_]/u.test(character)) {
      const start = index;
      index = sqlKeywordEnd(sql, start);
      if (depth === 0) {
        keywords.push(sql.slice(start, index).toUpperCase());
      }
      continue;
    }
    index += 1;
  }

  return keywords;
}

export function isTursoReadStatement(sql: string): boolean {
  const keywords = topLevelKeywords(sql);
  const first = keywords[0];
  if (first === "SELECT") {
    return true;
  }
  if (first !== "WITH") {
    return false;
  }

  return (
    keywords.slice(1).find((keyword) => rootStatementKeywords.has(keyword)) ===
    "SELECT"
  );
}
