import {
  type Client,
  type Config,
  createClient,
  type ResultSet,
  type Row,
  type Transaction,
} from "@libsql/client/ws";
import {
  drizzle as drizzleLibsql,
  type LibSQLDatabase,
} from "drizzle-orm/libsql";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import * as schema from "../schema";
import { unsafeCoerce } from "../unsafeCoerce.js";
import type {
  ApiDatabase,
  ApiDatabaseSurface,
  ApiSchema,
  DatabaseTransaction,
  ManagedApiDatabase,
  TransactionCallback,
} from "./types";

interface TursoAdapterEnv {
  readonly TURSO_AUTH_TOKEN?: string | undefined;
  readonly TURSO_DATABASE_URL?: string | undefined;
}

interface TursoConnectionConfig {
  readonly authToken: string;
  readonly intMode: "bigint";
  readonly url: string;
}

function requireEnvValue(
  env: TursoAdapterEnv,
  key: keyof TursoAdapterEnv,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required when API_DATABASE=turso`);
  }
  return value;
}

export function readTursoConnectionConfig(
  env: TursoAdapterEnv,
): TursoConnectionConfig {
  const url = requireEnvValue(env, "TURSO_DATABASE_URL");
  if (!url.startsWith("libsql://")) {
    throw new Error(
      "TURSO_DATABASE_URL must use libsql://; local files and embedded replicas are not supported",
    );
  }

  return {
    authToken: requireEnvValue(env, "TURSO_AUTH_TOKEN"),
    // Decode losslessly first; normalize safe values back to numbers before
    // Drizzle applies per-column codecs below.
    intMode: "bigint",
    url,
  };
}

const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function normalizeSafeInteger(value: unknown): unknown {
  if (
    typeof value === "bigint" &&
    value >= MIN_SAFE_INTEGER_BIGINT &&
    value <= MAX_SAFE_INTEGER_BIGINT
  ) {
    return Number(value);
  }
  return value;
}

function normalizeResultRow(row: Row): Row {
  return new Proxy(row, {
    get(target, property, receiver) {
      return normalizeSafeInteger(Reflect.get(target, property, receiver));
    },
  });
}

function normalizeResultSet(result: ResultSet): ResultSet {
  const normalizedRows = result.rows.map(normalizeResultRow);
  return new Proxy(result, {
    get(target, property, receiver) {
      return property === "rows"
        ? normalizedRows
        : Reflect.get(target, property, receiver);
    },
  });
}

type AsyncClientMethod = (...args: unknown[]) => Promise<unknown>;

function bindAsyncMethod(target: object, property: string): AsyncClientMethod {
  const method = Reflect.get(target, property);
  if (typeof method !== "function") {
    throw new Error(`Turso client method ${property} is unavailable`);
  }
  return unsafeCoerce<AsyncClientMethod>(method.bind(target));
}

function normalizeTursoTransactionIntegers(
  transaction: Transaction,
): Transaction {
  return new Proxy(transaction, {
    get(target, property) {
      if (property === "execute") {
        const execute = bindAsyncMethod(target, "execute");
        return async (...args: unknown[]) =>
          normalizeResultSet(unsafeCoerce<ResultSet>(await execute(...args)));
      }
      if (property === "batch") {
        const batch = bindAsyncMethod(target, "batch");
        return async (...args: unknown[]) =>
          unsafeCoerce<ResultSet[]>(await batch(...args)).map(
            normalizeResultSet,
          );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// libSQL exposes one global integer mode, while the API schema mixes ordinary
// JS numbers with true 64-bit bigint cursors. Decode every integer as bigint to
// avoid range failures, then convert only safe values back to number before
// Drizzle's column codecs run. Bigint columns still receive bigint (or convert
// a safe number back with their codec), while timestamps and counters retain
// their established number behavior.
export function normalizeTursoResultIntegers(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "execute") {
        const execute = bindAsyncMethod(target, "execute");
        return async (...args: unknown[]) =>
          normalizeResultSet(unsafeCoerce<ResultSet>(await execute(...args)));
      }
      if (property === "batch" || property === "migrate") {
        const batch = bindAsyncMethod(target, property);
        return async (...args: unknown[]) =>
          unsafeCoerce<ResultSet[]>(await batch(...args)).map(
            normalizeResultSet,
          );
      }
      if (property === "transaction") {
        const transaction = bindAsyncMethod(target, "transaction");
        return async (...args: unknown[]) =>
          normalizeTursoTransactionIntegers(
            unsafeCoerce<Transaction>(await transaction(...args)),
          );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Turso uses the SQLite dialect, so SELECT FOR UPDATE intentionally degrades to
// a plain select. Every API transaction must therefore reserve the remote writer
// up front: BEGIN IMMEDIATE is the load-bearing isolation boundary for mutation
// workflows. Drizzle 0.45 does not forward its SQLite transaction config, so
// force write mode here. This also means today's read-only transactions reserve
// the writer; introducing read transactions requires a distinct API surface.
export function forceTursoWriteTransactions(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "transaction") {
        return (_mode?: unknown) => target.transaction("write");
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

interface LibsqlRawExecutor {
  all(query: unknown): Promise<unknown[]>;
}

function attachExecute<Database>(
  database: Database,
): Database & Pick<ApiDatabaseSurface, "execute"> {
  const rawExecutor = unsafeCoerce<LibsqlRawExecutor>(database);
  const bridge = unsafeCoerce<Database & Pick<ApiDatabaseSurface, "execute">>(
    database,
  );
  bridge.execute = unsafeCoerce<ApiDatabaseSurface["execute"]>(
    async (query: Parameters<ApiDatabaseSurface["execute"]>[0]) => ({
      rows: await rawExecutor.all(query),
    }),
  );
  return bridge;
}

function attachTransactionExecute(transaction: unknown): DatabaseTransaction {
  const transactionBridge = unsafeCoerce<DatabaseTransaction>(
    attachExecute(transaction),
  );
  // Drizzle currently allocates a fresh LibSQLTransaction for every callback;
  // this in-place wrapper relies on that and must not be applied twice.
  const rawNestedTransaction =
    transactionBridge.transaction.bind(transactionBridge);
  transactionBridge.transaction = unsafeCoerce<
    DatabaseTransaction["transaction"]
  >((callback: TransactionCallback) =>
    rawNestedTransaction((nested) =>
      callback(attachTransactionExecute(nested)),
    ),
  );
  return transactionBridge;
}

export function attachTursoDatabaseBridge(
  libsqlDatabase: LibSQLDatabase<ApiSchema>,
): ApiDatabase {
  const bridge = attachExecute(libsqlDatabase);
  const rawTransaction = bridge.transaction.bind(bridge);
  const apiBridge = unsafeCoerce<ApiDatabase>(bridge);
  apiBridge.transaction = unsafeCoerce<ApiDatabase["transaction"]>(
    (callback: TransactionCallback) =>
      rawTransaction((transaction) =>
        callback(attachTransactionExecute(transaction)),
      ),
  );
  return apiBridge;
}

export function createTursoApiDatabase(
  env: TursoAdapterEnv,
  migrationsFolder: string,
): ManagedApiDatabase {
  const config: Config = readTursoConnectionConfig(env);
  const client = createClient(config);
  const libsqlDb = drizzleLibsql({
    client: normalizeTursoResultIntegers(forceTursoWriteTransactions(client)),
    schema,
  });

  return {
    db: attachTursoDatabaseBridge(libsqlDb),
    kind: "turso",
    close: async () => client.close(),
    migrate: (options) =>
      migrateLibsql(libsqlDb, {
        migrationsFolder: options?.migrationsFolder ?? migrationsFolder,
      }),
  };
}
