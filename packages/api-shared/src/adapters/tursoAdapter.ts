import {
  type Client,
  type Config,
  createClient,
  type InArgs,
  type InStatement,
  type ResultSet,
  type Row,
  type Transaction,
  type TransactionMode,
} from "@libsql/client/ws";
import type { LibSQLDatabase } from "drizzle-orm/libsql/driver-core";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql/ws";
import * as schema from "../schema";
import { unsafeCoerce } from "../unsafeCoerce.js";
import { isTursoReadStatement } from "./tursoStatementMode";
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
  readonly TURSO_PRIMARY_INSTANCE_ID?: string | undefined;
}

interface TursoConnectionConfig {
  readonly authToken: string;
  readonly intMode: "bigint";
  readonly tls: true;
  readonly url: string;
}

const tursoInstanceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
  const parsedUrl = new URL(url);
  if (parsedUrl.searchParams.getAll("tls").includes("0")) {
    throw new Error(
      "TURSO_DATABASE_URL must not disable TLS; plaintext remote connections are not supported",
    );
  }
  if (parsedUrl.searchParams.has("authToken")) {
    throw new Error(
      "TURSO_DATABASE_URL must not contain authToken; use TURSO_AUTH_TOKEN",
    );
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error(
      "TURSO_DATABASE_URL must not contain userinfo credentials; use TURSO_AUTH_TOKEN",
    );
  }
  if (!parsedUrl.hostname.endsWith(".turso.io")) {
    throw new Error(
      "TURSO_DATABASE_URL must identify a managed Turso database; arbitrary libSQL replicas are not supported",
    );
  }

  const primaryInstanceId = requireEnvValue(env, "TURSO_PRIMARY_INSTANCE_ID");
  if (!tursoInstanceIdPattern.test(primaryInstanceId)) {
    throw new Error(
      "TURSO_PRIMARY_INSTANCE_ID must be the UUID of the database's primary instance",
    );
  }
  const primaryPrefix = `${primaryInstanceId}-`;
  if (!parsedUrl.hostname.startsWith(primaryPrefix)) {
    parsedUrl.hostname = `${primaryPrefix}${parsedUrl.hostname}`;
  }

  return {
    authToken: requireEnvValue(env, "TURSO_AUTH_TOKEN"),
    // Decode losslessly first; normalize safe values back to numbers before
    // Drizzle applies per-column codecs below.
    intMode: "bigint",
    tls: true,
    // Turso's ordinary database hostname may route legacy Data Edge users to
    // a lagging replica. Prefixing the primary instance UUID selects the
    // primary directly, preserving the API's linearizable read contract
    // without turning every SELECT into a writer-reserving transaction.
    url: parsedUrl.toString(),
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

type ForeignKeyTransactionMode = Extract<TransactionMode, "deferred" | "write">;

function foreignKeyTransactionSetup(mode: ForeignKeyTransactionMode): string {
  const begin = mode === "deferred" ? "BEGIN DEFERRED" : "BEGIN IMMEDIATE";
  return `ROLLBACK; PRAGMA foreign_keys = ON; ${begin}`;
}

async function openForeignKeyTransaction(
  client: Client,
  mode: ForeignKeyTransactionMode = "write",
): Promise<Transaction> {
  const transaction = await client.transaction(mode);
  try {
    // @libsql/client starts BEGIN before a transaction's first statement, but
    // SQLite ignores changes to foreign_keys inside a transaction. Restart the
    // same remote stream so the PRAGMA runs in autocommit mode, then verify the
    // load-bearing setting before exposing the transaction to Drizzle.
    await transaction.executeMultiple(foreignKeyTransactionSetup(mode));
    const result = await transaction.execute("PRAGMA foreign_keys");
    const enabled = result.rows[0]?.[0];
    if (enabled !== 1 && enabled !== 1n) {
      throw new Error(
        "Turso connection did not enable foreign key enforcement",
      );
    }
    return transaction;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Preserve the setup failure.
    }
    transaction.close();
    throw error;
  }
}

async function withForeignKeyTransaction<T>(
  client: Client,
  mode: ForeignKeyTransactionMode,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const transaction = await openForeignKeyTransaction(client, mode);
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Preserve the operation or commit failure.
    }
    throw error;
  } finally {
    transaction.close();
  }
}

function executeStatementFromArgs(args: unknown[]): InStatement {
  const statement = args[0];
  if (typeof statement === "string" && args.length > 1) {
    return { args: unsafeCoerce<InArgs>(args[1]), sql: statement };
  }
  return unsafeCoerce<InStatement>(statement);
}

function statementSql(statement: InStatement): string {
  return typeof statement === "string" ? statement : statement.sql;
}

function isReadStatement(statement: InStatement): boolean {
  return isTursoReadStatement(statementSql(statement));
}

function transactionBatchStatements(args: unknown[]): InStatement[] {
  return unsafeCoerce<Array<InStatement | [string, InArgs?]>>(args[0]).map(
    (statement) =>
      Array.isArray(statement)
        ? {
            ...(statement[1] === undefined ? {} : { args: statement[1] }),
            sql: statement[0],
          }
        : statement,
  );
}

// Turso follows SQLite's default of disabling foreign-key enforcement for each
// remote session. Route every normal root statement and interactive transaction
// through a stream that enables and verifies the PRAGMA first. The dedicated
// `migrate` method remains untouched because @libsql/client deliberately
// disables constraints around schema migrations and reenables them afterward.
export function enforceTursoForeignKeys(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "transaction") {
        return () => openForeignKeyTransaction(target);
      }
      if (property === "execute") {
        return (...args: unknown[]) => {
          const statement = executeStatementFromArgs(args);
          return withForeignKeyTransaction(
            target,
            isReadStatement(statement) ? "deferred" : "write",
            (transaction) => transaction.execute(statement),
          );
        };
      }
      if (property === "batch") {
        return (...args: unknown[]) => {
          const statements = transactionBatchStatements(args);
          return withForeignKeyTransaction(
            target,
            statements.every(isReadStatement) ? "deferred" : "write",
            (transaction) => transaction.batch(statements),
          );
        };
      }
      if (property === "executeMultiple") {
        return (...args: unknown[]) =>
          withForeignKeyTransaction(target, "write", (transaction) =>
            transaction.executeMultiple(unsafeCoerce<string>(args[0])),
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
    client: normalizeTursoResultIntegers(
      forceTursoWriteTransactions(enforceTursoForeignKeys(client)),
    ),
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
