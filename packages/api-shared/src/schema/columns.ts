import { randomUUID } from "node:crypto";
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  check as pgCheck,
  index as pgIndex,
  integer as pgInteger,
  jsonb as pgJsonb,
  text as pgText,
  timestamp as pgTimestamp,
  uniqueIndex as pgUniqueIndex,
  uuid as pgUuid,
  pgTable as postgresTable,
} from "drizzle-orm/pg-core";
import {
  check as sqliteCheck,
  index as sqliteIndex,
  integer as sqliteInteger,
  numeric as sqliteNumeric,
  sqliteTable,
  text as sqliteText,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";
import { unsafeCoerce } from "../unsafeCoerce.js";
import { isSqliteSchemaDialect } from "./dialect";

const isSqlite = isSqliteSchemaDialect();

const pgBigintNumber = (name: string) =>
  pgBigint(name, { mode: "number" }).generatedAlwaysAsIdentity();
const pgBigintBigInt = (name: string) => pgBigint(name, { mode: "bigint" });
const pgBooleanColumn = (name: string) => pgBoolean(name);
const pgIntegerColumn = (name: string) => pgInteger(name);
const pgJsonColumn = (name: string) => pgJsonb(name);
const pgTimestampColumn = (name: string) => pgTimestamp(name);
const pgUuidColumn = (name: string) => pgUuid(name);

type PgBigintNumberBuilder = ReturnType<typeof pgBigintNumber>;
type PgBigintBigIntBuilder = ReturnType<typeof pgBigintBigInt>;
type PgBooleanBuilder = ReturnType<typeof pgBooleanColumn>;
type PgIntegerBuilder = ReturnType<typeof pgIntegerColumn>;
type PgJsonBuilder = ReturnType<typeof pgJsonColumn>;
type PgTimestampBuilder = ReturnType<typeof pgTimestampColumn>;
type PgUuidBuilder = ReturnType<typeof pgUuidColumn>;

const sqliteTableAny = unsafeCoerce<typeof postgresTable>(sqliteTable);
const sqliteIndexAny = unsafeCoerce<typeof pgIndex>(sqliteIndex);
const sqliteCheckAny = unsafeCoerce<typeof pgCheck>(sqliteCheck);
const sqliteUniqueIndexAny =
  unsafeCoerce<typeof pgUniqueIndex>(sqliteUniqueIndex);
const sqliteTextAny = unsafeCoerce<typeof pgText>(sqliteText);

interface SqliteRuntimeIntegerBuilder {
  config: { autoIncrement?: boolean; hasDefault?: boolean };
  generatedAlwaysAsIdentity(): unknown;
}

interface SqliteRuntimeUuidBuilder {
  $defaultFn(defaultFn: () => string): unknown;
  defaultRandom(): unknown;
}

type SqliteIntegerBridge = (
  name: string,
  config?: { mode?: "boolean" | "timestamp_ms" },
) => unknown;
type SqliteTextBridge = (name: string, config?: { mode?: "json" }) => unknown;

const sqliteIntegerBridge = unsafeCoerce<SqliteIntegerBridge>(sqliteInteger);
const sqliteTextBridge = unsafeCoerce<SqliteTextBridge>(sqliteText);

// Maps Postgres `GENERATED ALWAYS AS IDENTITY` bigint sequence columns
// (e.g. document_audit_entries.sequence) onto a real engine-managed SQLite
// identity. `.generatedAlwaysAsIdentity()` flips the underlying integer column
// to `INTEGER PRIMARY KEY AUTOINCREMENT` (the schema pairs it with
// `.primaryKey()`), so monotonicity and uniqueness are owned by SQLite itself
// rather than a JS counter — matching how packages/loro emits
// document_updates.sequence. Audit rows are hash-chained by selecting the
// latest `sequence` per document, which AUTOINCREMENT keeps strictly
// increasing.
function sqliteBigint(
  name: string,
  config: { mode: "number" | "bigint" },
): PgBigintNumberBuilder | PgBigintBigIntBuilder {
  if (config.mode === "bigint") {
    return unsafeCoerce<PgBigintBigIntBuilder>(
      sqliteNumeric(name, { mode: "bigint" }),
    );
  }

  const builder = unsafeCoerce<SqliteRuntimeIntegerBuilder>(
    sqliteIntegerBridge(name),
  );
  builder.generatedAlwaysAsIdentity = () => {
    builder.config.autoIncrement = true;
    builder.config.hasDefault = true;
    return builder;
  };
  return unsafeCoerce<PgBigintNumberBuilder>(builder);
}

function sqliteBoolean(name: string): PgBooleanBuilder {
  return unsafeCoerce<PgBooleanBuilder>(
    sqliteIntegerBridge(name, {
      mode: "boolean",
    }),
  );
}

function sqliteIntegerColumn(name: string): PgIntegerBuilder {
  return unsafeCoerce<PgIntegerBuilder>(sqliteIntegerBridge(name));
}

function sqliteJson(name: string): PgJsonBuilder {
  return unsafeCoerce<PgJsonBuilder>(sqliteTextBridge(name, { mode: "json" }));
}

function sqliteTimestamp(name: string): PgTimestampBuilder {
  return unsafeCoerce<PgTimestampBuilder>(
    sqliteIntegerBridge(name, {
      mode: "timestamp_ms",
    }),
  );
}

function sqliteUuid(name: string): PgUuidBuilder {
  const builder = unsafeCoerce<SqliteRuntimeUuidBuilder>(
    sqliteTextBridge(name),
  );
  builder.defaultRandom = () => builder.$defaultFn(randomUUID);
  return unsafeCoerce<PgUuidBuilder>(builder);
}

const sqliteBigintAny = unsafeCoerce<typeof pgBigint>(sqliteBigint);
const sqliteBooleanAny = unsafeCoerce<typeof pgBoolean>(sqliteBoolean);
const sqliteIntegerColumnAny =
  unsafeCoerce<typeof pgInteger>(sqliteIntegerColumn);
const sqliteJsonAny = unsafeCoerce<typeof pgJsonb>(sqliteJson);
const sqliteTimestampAny = unsafeCoerce<typeof pgTimestamp>(sqliteTimestamp);
const sqliteUuidAny = unsafeCoerce<typeof pgUuid>(sqliteUuid);

export const pgTable: typeof postgresTable = isSqlite
  ? sqliteTableAny
  : postgresTable;
export const index: typeof pgIndex = isSqlite ? sqliteIndexAny : pgIndex;
export const check: typeof pgCheck = isSqlite ? sqliteCheckAny : pgCheck;
export const uniqueIndex: typeof pgUniqueIndex = isSqlite
  ? sqliteUniqueIndexAny
  : pgUniqueIndex;

export const bigint: typeof pgBigint = isSqlite ? sqliteBigintAny : pgBigint;
export const boolean: typeof pgBoolean = isSqlite
  ? sqliteBooleanAny
  : pgBoolean;
export const integer: typeof pgInteger = isSqlite
  ? sqliteIntegerColumnAny
  : pgInteger;
export const jsonb: typeof pgJsonb = isSqlite ? sqliteJsonAny : pgJsonb;
export const text: typeof pgText = isSqlite ? sqliteTextAny : pgText;
export const timestamp: typeof pgTimestamp = isSqlite
  ? sqliteTimestampAny
  : pgTimestamp;
export const uuid: typeof pgUuid = isSqlite ? sqliteUuidAny : pgUuid;
