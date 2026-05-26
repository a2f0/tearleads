import type {
  RemoteCallback,
  SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { clientSQLiteSchema } from "./schema";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
  type SqlRowValue,
} from "./sqlSchema";

export type ClientSQLiteSchema = typeof clientSQLiteSchema;
export type ClientSQLiteDatabase = SqliteRemoteDatabase<ClientSQLiteSchema>;
export type ClientSQLiteTransaction = Parameters<
  Parameters<ClientSQLiteDatabase["transaction"]>[0]
>[0];

export interface ClientSQLitePersistenceRuntime {
  db: ClientSQLiteDatabase;
  execSql: ExecSql;
  runMutation<T>(
    operation: (db: ClientSQLiteDatabase) => Promise<T> | T,
  ): Promise<T>;
  transaction<T>(
    operation: (tx: ClientSQLiteTransaction) => Promise<T>,
  ): Promise<T>;
}

const runtimeByExecSql = new WeakMap<ExecSql, ClientSQLitePersistenceRuntime>();
const execSqlByClient = new WeakMap<ExecSqlClientLike, ExecSql>();

function toSqlRowValue(value: unknown): SqlRowValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  throw new Error(`Unsupported SQLite bind value: ${String(value)}`);
}

function createRemoteCallback(getExecSql: () => ExecSql): RemoteCallback {
  type RemoteResult = Awaited<ReturnType<RemoteCallback>>;

  return async (sql, params, method) => {
    const rows = await getExecSql()(sql, params.map(toSqlRowValue), {
      rowMode: "array",
    });

    if (method === "get") {
      return { rows: rows[0] ?? [] } satisfies RemoteResult;
    }

    return { rows } satisfies RemoteResult;
  };
}

function createClientSQLiteDatabase(
  getExecSql: () => ExecSql,
): ClientSQLiteDatabase {
  return drizzle(createRemoteCallback(getExecSql), {
    schema: clientSQLiteSchema,
  });
}

function createRuntimeForExecSql(
  execSql: ExecSql,
): ClientSQLitePersistenceRuntime {
  let activeExecSql = execSql;
  const db = createClientSQLiteDatabase(() => activeExecSql);

  async function withActiveExecSql<T>(
    nextExecSql: ExecSql,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previousExecSql = activeExecSql;
    activeExecSql = nextExecSql;

    try {
      return await operation();
    } finally {
      activeExecSql = previousExecSql;
    }
  }

  const runtime: ClientSQLitePersistenceRuntime = {
    db,
    execSql,
    runMutation(operation) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, () => operation(db)),
      );
    },
    transaction(operation) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
        withActiveExecSql(lockedExecSql, () => db.transaction(operation)),
      );
    },
  };

  runtimeByExecSql.set(execSql, runtime);
  return runtime;
}

export function getClientSQLitePersistenceRuntime(
  execSql: ExecSql,
): ClientSQLitePersistenceRuntime {
  return runtimeByExecSql.get(execSql) ?? createRuntimeForExecSql(execSql);
}

export function createClientSQLitePersistenceRuntime(
  client: ExecSqlClientLike,
): ClientSQLitePersistenceRuntime {
  let execSql = execSqlByClient.get(client);
  if (!execSql) {
    execSql = createExecSql(client);
    execSqlByClient.set(client, execSql);
  }

  return getClientSQLitePersistenceRuntime(execSql);
}
