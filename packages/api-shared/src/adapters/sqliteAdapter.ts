import { Database as SqliteDatabase } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type BunSQLiteDatabase,
  drizzle as drizzleBunSqlite,
} from "drizzle-orm/bun-sqlite";
import { migrate as migrateBunSqlite } from "drizzle-orm/bun-sqlite/migrator";
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

interface SqliteAdapterOptions {
  readonly sqlitePath: string;
  readonly migrationsFolder: string;
}

function attachSqliteExecute(
  db: BunSQLiteDatabase<ApiSchema>,
): BunSQLiteDatabase<ApiSchema> & Pick<ApiDatabaseSurface, "execute"> {
  const database = unsafeCoerce<{
    execute(query: Parameters<ApiDatabaseSurface["execute"]>[0]): Promise<{
      readonly rows: readonly unknown[];
    }>;
  }>(db);
  database.execute = (query: Parameters<ApiDatabaseSurface["execute"]>[0]) =>
    Promise.resolve({
      rows: db.all(query),
    });
  return unsafeCoerce<
    BunSQLiteDatabase<ApiSchema> & Pick<ApiDatabaseSurface, "execute">
  >(database);
}

// drizzle's query builders are lazy thenables: every builder (insert/update/
// delete/execute result) ultimately funnels through `.execute()`, and `.then`
// delegates to it. `db.insert(table)`/`db.select(...)`/`db.update(table)` return
// a *factory* (whose `.values(...)`/`.from(...)`/`.set(...)` produces the
// awaitable builder); the rest return the awaitable builder directly. We exploit
// this to route the terminal `.execute()` of every root-level statement through
// the same serialization gate as transactions.
interface DrizzleExecutable {
  execute(...args: unknown[]): Promise<unknown>;
}

function readProperty(value: object, key: string): unknown {
  return unsafeCoerce<Record<string, unknown>>(value)[key];
}

function hasExecute(value: unknown): value is DrizzleExecutable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof readProperty(value, "execute") === "function"
  );
}

// `values` = insert factory, `from` = select factory, `set` = update factory.
// Without `set`, a root `db.update(t).set(...)` builder is never wrapped, so its
// `.execute()` runs outside the serial queue and can interleave inside an
// in-flight transaction's begin/rollback window on the shared connection.
const FACTORY_HOP_METHODS = ["values", "from", "set"] as const;

function factoryHop(
  value: unknown,
): { name: string; call: (...args: unknown[]) => unknown } | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  for (const name of FACTORY_HOP_METHODS) {
    const candidate = readProperty(value, name);
    if (typeof candidate === "function") {
      const call = unsafeCoerce<(...args: unknown[]) => unknown>(
        candidate.bind(value),
      );
      return { name, call };
    }
  }
  return undefined;
}

type SqliteStatementBridge = {
  transaction(callback: TransactionCallback): Promise<unknown>;
  delete: ApiDatabase["delete"];
  execute: ApiDatabase["execute"];
  insert: ApiDatabase["insert"];
  select: ApiDatabase["select"];
  update: ApiDatabase["update"];
};

interface SqliteSerializer {
  // Runs `work` inside the serial queue unless already inside a queued unit
  // (an active transaction), in which case it runs directly to avoid deadlock.
  readonly serialize: <T>(work: () => Promise<T>) => Promise<T>;
  readonly inUnit: () => boolean;
}

// Wrap a builder's terminal `.execute()` so it runs through the serializer,
// leaving every chainable method (.values/.returning/.where/...) intact.
function serializeBuilder(builder: unknown, s: SqliteSerializer): unknown {
  if (hasExecute(builder)) {
    const original = builder.execute.bind(builder);
    Reflect.set(builder, "execute", (...args: unknown[]) =>
      s.inUnit() ? original(...args) : s.serialize(() => original(...args)),
    );
  }
  return builder;
}

function serializeStatementMethod<Method extends (...args: never[]) => unknown>(
  method: Method,
  s: SqliteSerializer,
): Method {
  return unsafeCoerce<Method>((...args: Parameters<Method>) => {
    const builder = method(...args);
    // If the builder isn't awaitable yet, wrap its factory hop (.values/.from)
    // so the awaitable it produces gets serialized; otherwise it is awaitable
    // already.
    const hop = hasExecute(builder) ? undefined : factoryHop(builder);
    if (hop !== undefined) {
      Reflect.set(unsafeCoerce<object>(builder), hop.name, (...a: unknown[]) =>
        serializeBuilder(hop.call(...a), s),
      );
      return builder;
    }
    return serializeBuilder(builder, s);
  });
}

function wrapSqliteStatements(
  sqliteDb: ReturnType<typeof attachSqliteExecute>,
  s: SqliteSerializer,
): SqliteStatementBridge {
  const dbBridge = unsafeCoerce<SqliteStatementBridge>(sqliteDb);
  dbBridge.delete = serializeStatementMethod(dbBridge.delete.bind(dbBridge), s);
  dbBridge.insert = serializeStatementMethod(dbBridge.insert.bind(dbBridge), s);
  dbBridge.select = serializeStatementMethod(dbBridge.select.bind(dbBridge), s);
  dbBridge.update = serializeStatementMethod(dbBridge.update.bind(dbBridge), s);
  // `execute` is the raw-SQL shim from attachSqliteExecute (an eager async
  // function, not a lazy drizzle builder), so wrap the call itself, deferring
  // the synchronous `db.all` into the queued unit.
  const rawExecute = dbBridge.execute.bind(dbBridge);
  dbBridge.execute = unsafeCoerce<ApiDatabase["execute"]>(
    (query: Parameters<ApiDatabase["execute"]>[0]) =>
      s.inUnit() ? rawExecute(query) : s.serialize(() => rawExecute(query)),
  );
  return dbBridge;
}

// All statements share one bun:sqlite connection, so an `await` inside a
// transaction callback could otherwise let an unrelated statement run inside
// the open `begin immediate` window and be committed/rolled back with it. We
// route every root-level statement AND every transaction through one serial
// queue so units never interleave on the connection.
function createSerializedSqliteBridge(
  client: SqliteDatabase,
  sqliteDb: ReturnType<typeof attachSqliteExecute>,
): SqliteStatementBridge {
  const transactionContext = new AsyncLocalStorage<{
    readonly depth: number;
  }>();
  let transactionQueue = Promise.resolve();
  let savepointCounter = 0;

  const swallow = (): undefined => undefined;
  const serializer: SqliteSerializer = {
    inUnit: () => transactionContext.getStore() !== undefined,
    serialize: <T>(work: () => Promise<T>): Promise<T> => {
      const result = transactionQueue.then(work, work);
      transactionQueue = result.then(swallow, swallow);
      return result;
    },
  };

  // Rollback/release can themselves throw (e.g. the connection was already
  // auto-rolled-back under SQLITE_FULL/SQLITE_IOERR, which also discards
  // savepoints); never let a cleanup failure mask the original error.
  const safeExec = (statement: string): void => {
    try {
      client.exec(statement);
    } catch {
      // Preserve the root-cause error at the call site.
    }
  };

  const transactionDb = unsafeCoerce<DatabaseTransaction>(sqliteDb);
  const runSqliteTransaction = async (callback: TransactionCallback) => {
    const activeTransaction = transactionContext.getStore();
    if (activeTransaction) {
      const savepointName = `tearleads_sp_${++savepointCounter}`;
      client.exec(`savepoint ${savepointName}`);
      try {
        const result = await transactionContext.run(
          { depth: activeTransaction.depth + 1 },
          () => callback(transactionDb),
        );
        client.exec(`release savepoint ${savepointName}`);
        return result;
      } catch (error) {
        safeExec(`rollback to savepoint ${savepointName}`);
        safeExec(`release savepoint ${savepointName}`);
        throw error;
      }
    }

    return serializer.serialize(() =>
      transactionContext.run({ depth: 0 }, async () => {
        client.exec("begin immediate");
        try {
          const result = await callback(transactionDb);
          client.exec("commit");
          return result;
        } catch (error) {
          safeExec("rollback");
          throw error;
        }
      }),
    );
  };

  const dbBridge = wrapSqliteStatements(sqliteDb, serializer);
  dbBridge.transaction = runSqliteTransaction;
  return dbBridge;
}

export function createSqliteApiDatabase(
  options: SqliteAdapterOptions,
): ManagedApiDatabase {
  const client = new SqliteDatabase(options.sqlitePath, { create: true });
  client.exec("PRAGMA foreign_keys = ON");
  const sqliteDb = attachSqliteExecute(drizzleBunSqlite({ client, schema }));
  const dbBridge = createSerializedSqliteBridge(client, sqliteDb);

  return {
    db: unsafeCoerce<ApiDatabase>(dbBridge),
    kind: "sqlite",
    close: async () => client.close(),
    migrate: async (migrateOptions) => {
      migrateBunSqlite(sqliteDb, {
        migrationsFolder:
          migrateOptions?.migrationsFolder ?? options.migrationsFolder,
      });
    },
  };
}
