import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

export function textExpression(expression: SQL): SQL {
  return sql`${expression}::text`;
}

export function uuidValue(value: string): SQL {
  return sql`${value}::uuid`;
}

export function uuidExpression(expression: SQL): SQL {
  return sql`${expression}::uuid`;
}

export function intExpression(expression: SQL): SQL {
  return sql`${expression}::int`;
}

// UTF-8 byte length of a text value, read from the stored datum without
// detoasting.
export function textByteLengthExpression(expression: SQLWrapper): SQL {
  return sql`octet_length(${expression})`;
}

// At most the UTF-8 bytes of a stored JSON value's compact serialization.
// Postgres renders jsonb with a space after every ':' and ','; dropping each
// such pair, even inside a string, can only undercount.
export function jsonByteFloorExpression(expression: SQLWrapper): SQL {
  return sql`octet_length(replace(replace(${expression}::text, ', ', ','), ': ', ':'))`;
}

// PostgreSQL now() is fixed at transaction start. Lifecycle deadlines that
// begin after lock acquisition must use the statement wall clock so time spent
// waiting inside the transaction cannot consume their safety window.
export function wallClockNowExpression(): SQL {
  return sql`timezone('UTC', clock_timestamp())`;
}

function readBooleanFromDriver(value: unknown): boolean {
  return value === true;
}

export function booleanExpression(expression: SQL): SQL<boolean> {
  return sql<boolean>`${expression}`.mapWith(readBooleanFromDriver);
}

// A uuid column compared with a uuid read from JSON text. Postgres must compare
// in the column's own type to use its index; casting the column to text forces
// a pass over every row. Only lowercase canonical text casts, so the match is
// exactly the text equality it replaces, and malformed text matches nothing
// instead of failing the statement.
export function uuidColumnEqualsJsonText(
  column: SQL,
  jsonText: SQL,
): SQL<boolean> {
  return sql<boolean>`${column} = case when ${jsonText} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (${jsonText})::uuid end`;
}

export function jsonTextProperty(expression: SQL, property: string): SQL {
  return sql`${expression}->>${property}`;
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
  return sql`position(${needle} in ${pathExpression}) > 0`;
}

export function readDateValue(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}
