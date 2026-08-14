import { randomUUID } from "node:crypto";
import {
  index as pgIndex,
  integer as pgInteger,
  text as pgText,
  timestamp as pgTimestamp,
  uniqueIndex as pgUniqueIndex,
  uuid as pgUuid,
  pgTable as postgresTable,
} from "drizzle-orm/pg-core";
import {
  index as sqliteIndex,
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";
import { unsafeCoerce } from "../unsafeCoerce.js";

type LoroServerSchemaDialect = "postgres" | "sqlite";

interface LoroServerSchemaDialectEnv {
  readonly API_DATABASE?: string | undefined;
  readonly [key: string]: string | undefined;
}

function readLoroServerSchemaDialect(): LoroServerSchemaDialect {
  const env: LoroServerSchemaDialectEnv = process.env;
  const database = env.API_DATABASE?.trim().toLowerCase();
  return database === "sqlite" || database === "turso" ? "sqlite" : "postgres";
}

export const loroServerSchemaDialect = readLoroServerSchemaDialect();
const isSqlite = loroServerSchemaDialect === "sqlite";

const pgIntegerColumn = (name: string) => pgInteger(name);
const pgTimestampColumn = (name: string) => pgTimestamp(name);
const pgUuidColumn = (name: string) => pgUuid(name);

type PgIntegerBuilder = ReturnType<typeof pgIntegerColumn>;
type PgTimestampBuilder = ReturnType<typeof pgTimestampColumn>;
type PgUuidBuilder = ReturnType<typeof pgUuidColumn>;

const sqliteTableAny = unsafeCoerce<typeof postgresTable>(sqliteTable);
const sqliteIndexAny = unsafeCoerce<typeof pgIndex>(sqliteIndex);
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
  config?: { mode?: "timestamp_ms" },
) => unknown;
type SqliteTextBridge = (name: string) => unknown;

const sqliteIntegerBridge = unsafeCoerce<SqliteIntegerBridge>(sqliteInteger);
const sqliteTextBridge = unsafeCoerce<SqliteTextBridge>(sqliteText);

function sqliteIntegerColumn(name: string): PgIntegerBuilder {
  const builder = unsafeCoerce<SqliteRuntimeIntegerBuilder>(
    sqliteIntegerBridge(name),
  );
  builder.generatedAlwaysAsIdentity = () => {
    builder.config.autoIncrement = true;
    builder.config.hasDefault = true;
    return builder;
  };
  return unsafeCoerce<PgIntegerBuilder>(builder);
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

const sqliteIntegerColumnAny =
  unsafeCoerce<typeof pgInteger>(sqliteIntegerColumn);
const sqliteTimestampAny = unsafeCoerce<typeof pgTimestamp>(sqliteTimestamp);
const sqliteUuidAny = unsafeCoerce<typeof pgUuid>(sqliteUuid);

export const pgTable: typeof postgresTable = isSqlite
  ? sqliteTableAny
  : postgresTable;
export const index: typeof pgIndex = isSqlite ? sqliteIndexAny : pgIndex;
export const integer: typeof pgInteger = isSqlite
  ? sqliteIntegerColumnAny
  : pgInteger;
export const text: typeof pgText = isSqlite ? sqliteTextAny : pgText;
export const timestamp: typeof pgTimestamp = isSqlite
  ? sqliteTimestampAny
  : pgTimestamp;
export const uniqueIndex: typeof pgUniqueIndex = isSqlite
  ? sqliteUniqueIndexAny
  : pgUniqueIndex;
export const uuid: typeof pgUuid = isSqlite ? sqliteUuidAny : pgUuid;
