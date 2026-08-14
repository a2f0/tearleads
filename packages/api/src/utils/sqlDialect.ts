import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { type SQL, sql } from "drizzle-orm";

export function isSqliteApiDatabase(): boolean {
  const kind = getDefaultApiDatabaseKind();
  return kind === "sqlite" || kind === "turso";
}

interface RowLockQuery<TResult> extends PromiseLike<TResult> {
  for(strength: "update"): PromiseLike<TResult>;
}

export function lockRowForUpdate<TResult>(
  query: RowLockQuery<TResult>,
): PromiseLike<TResult> {
  return isSqliteApiDatabase() ? query : query.for("update");
}

export function textExpression(expression: SQL): SQL {
  return isSqliteApiDatabase() ? expression : sql`${expression}::text`;
}

export function uuidValue(value: string): SQL {
  return isSqliteApiDatabase() ? sql`${value}` : sql`${value}::uuid`;
}

export function uuidExpression(expression: SQL): SQL {
  return isSqliteApiDatabase() ? expression : sql`${expression}::uuid`;
}

export function intExpression(expression: SQL): SQL {
  return isSqliteApiDatabase() ? expression : sql`${expression}::int`;
}

export function nowExpression(): SQL {
  return isSqliteApiDatabase()
    ? sql`cast((julianday('now') - 2440587.5)*86400000 as integer)`
    : sql`now()`;
}

export function timestampValue(value: Date): SQL {
  return isSqliteApiDatabase() ? sql`${value.getTime()}` : sql`${value}`;
}

function readBooleanFromDriver(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function booleanExpression(expression: SQL): SQL<boolean> {
  return sql<boolean>`${expression}`.mapWith(readBooleanFromDriver);
}

export function jsonTextProperty(expression: SQL, property: string): SQL {
  return isSqliteApiDatabase()
    ? sql`json_extract(${expression}, ${`$.${property}`})`
    : sql`${expression}->>${property}`;
}

export function visitedPathStart(expression: SQL): SQL {
  return sql`'|' || ${textExpression(expression)} || '|'`;
}

export function visitedPathAppend(pathExpression: SQL, expression: SQL): SQL {
  return sql`${pathExpression} || ${textExpression(expression)} || '|'`;
}

export function visitedPathContains(
  pathExpression: SQL,
  expression: SQL,
): SQL<boolean> {
  const needle = sql`'|' || ${textExpression(expression)} || '|'`;
  return isSqliteApiDatabase()
    ? sql`instr(${pathExpression}, ${needle}) > 0`
    : sql`position(${needle} in ${pathExpression}) > 0`;
}

export function readDateValue(value: unknown, label: string): Date {
  const date =
    typeof value === "number"
      ? new Date(value)
      : value instanceof Date
        ? value
        : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}

export function isSqlBooleanValue(value: unknown): value is boolean | 0 | 1 {
  return typeof value === "boolean" || value === 0 || value === 1;
}

export function readSqlBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return value === 1;
  }

  throw new Error(`${label} is not a boolean`);
}
