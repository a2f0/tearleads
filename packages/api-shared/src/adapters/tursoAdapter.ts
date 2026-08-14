import { type Client, type Config, createClient } from "@libsql/client/ws";
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
    url,
  };
}

// Drizzle 0.45 does not forward its SQLite transaction config to libSQL. Keep
// the selection explicit here so a future @libsql/client default change cannot
// silently turn API write transactions into deferred transactions.
export function forceTursoWriteTransactions(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === "transaction") {
        return () => target.transaction("write");
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
    client: forceTursoWriteTransactions(client),
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
