import type {
  RemoteCallback,
  SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { appSQLiteSchema } from "./schema";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
  type SqlRowValue,
} from "./sqlSchema";

export type AppSQLiteSchema = typeof appSQLiteSchema;
export type AppSQLiteDatabase = SqliteRemoteDatabase<AppSQLiteSchema>;
export type AppSQLiteTransaction = Parameters<
  Parameters<AppSQLiteDatabase["transaction"]>[0]
>[0];

export interface AppDatabaseRuntime {
  db: AppSQLiteDatabase;
  execSql: ExecSql;
  runMutation<T>(
    operation: (db: AppSQLiteDatabase) => Promise<T> | T,
  ): Promise<T>;
  transaction<T>(
    operation: (tx: AppSQLiteTransaction) => Promise<T>,
  ): Promise<T>;
}

const runtimeByExecSql = new WeakMap<ExecSql, AppDatabaseRuntime>();

function toSqlRowValue(value: unknown): SqlRowValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  throw new Error(`Unsupported SQLite bind value: ${String(value)}`);
}

function createRemoteCallback(execSql: ExecSql): RemoteCallback {
  type RemoteResult = Awaited<ReturnType<RemoteCallback>>;

  return async (sql, params, method) => {
    const rows = await execSql(sql, params.map(toSqlRowValue), {
      rowMode: "array",
    });

    if (method === "get") {
      return { rows: rows[0] } as RemoteResult;
    }

    return { rows } as RemoteResult;
  };
}

function createAppSQLiteDatabase(execSql: ExecSql): AppSQLiteDatabase {
  return drizzle(createRemoteCallback(execSql), { schema: appSQLiteSchema });
}

function createRuntimeForExecSql(execSql: ExecSql): AppDatabaseRuntime {
  const runtime: AppDatabaseRuntime = {
    db: createAppSQLiteDatabase(execSql),
    execSql,
    runMutation(operation) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        operation(getAppDatabaseRuntime(lockedExecSql).db),
      );
    },
    transaction(operation) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        getAppDatabaseRuntime(lockedExecSql).db.transaction(operation),
      );
    },
  };

  runtimeByExecSql.set(execSql, runtime);
  return runtime;
}

export function getAppDatabaseRuntime(execSql: ExecSql): AppDatabaseRuntime {
  return runtimeByExecSql.get(execSql) ?? createRuntimeForExecSql(execSql);
}

export function createAppDatabaseRuntime(
  client: ExecSqlClientLike,
): AppDatabaseRuntime {
  return getAppDatabaseRuntime(createExecSql(client));
}
