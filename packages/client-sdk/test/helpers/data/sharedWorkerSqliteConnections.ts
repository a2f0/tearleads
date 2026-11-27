import {
  createDatabaseWorkerConnectionFactory,
  type DatabaseConnectionRegistryOptions,
} from "@tearleads/sqlite-worker/database-connections";
import type { DatabaseWorkerExecOptions } from "@tearleads/sqlite-worker/types";
import type { RegisterDatabaseWorkerOptions } from "@tearleads/sqlite-worker/worker-core";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "../../../src/data/sqlite/sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "../../../src/data/sqlite/sqlSchema";

export interface SharedWorkerSqliteHookContext {
  readonly command: string;
  readonly options: DatabaseWorkerExecOptions;
  readonly role: string;
}

export interface OpenSharedWorkerSqliteConnectionsOptions {
  readonly afterExec?:
    | ((context: SharedWorkerSqliteHookContext) => Promise<void> | void)
    | undefined;
  readonly beforeExec?:
    | ((context: SharedWorkerSqliteHookContext) => Promise<void> | void)
    | undefined;
  readonly key: string;
  readonly leaseBounds?:
    | DatabaseConnectionRegistryOptions["leaseBounds"]
    | undefined;
}

export interface SharedWorkerSqliteConnections {
  readonly close: () => Promise<void>;
  readonly connect: (role: string) => Promise<ClientSQLitePersistenceRuntime>;
  readonly dbName: string;
}

/**
 * Opens connections backed by the SQLite worker's real connection registry and
 * transaction lease on a shared in-memory database. Tests that need to pause a
 * statement at a specific point pass `beforeExec` or `afterExec` hooks without
 * duplicating the worker's transaction ownership logic.
 */
export function createSharedWorkerSqliteConnections(
  options: OpenSharedWorkerSqliteConnectionsOptions,
): SharedWorkerSqliteConnections {
  const dbName = `/${crypto.randomUUID()}.db`;
  const createConnection = createDatabaseWorkerConnectionFactory({
    ...(options.leaseBounds ? { leaseBounds: options.leaseBounds } : {}),
    log: () => {},
  });
  const connections: RegisterDatabaseWorkerOptions[] = [];

  return {
    async close() {
      await Promise.all(
        connections.map((connection) => connection.onClose?.()),
      );
    },
    async connect(role: string): Promise<ClientSQLitePersistenceRuntime> {
      const connection = createConnection();
      await connection.onInit?.({
        cipher: "chacha20",
        dbName,
        key: options.key,
      });
      connections.push(connection);

      return createClientSQLitePersistenceRuntime({
        exec: async (execOptions) => {
          const command = execOptions.sql.trimStart().toUpperCase();
          const context: SharedWorkerSqliteHookContext = {
            command,
            options: execOptions,
            role,
          };
          await options.beforeExec?.(context);
          const rows = ((await connection.onExec?.(execOptions)) ??
            []) as Array<SqlRow | SqlArrayRow>;
          await options.afterExec?.(context);
          return { rows };
        },
      });
    },
    dbName,
  };
}
