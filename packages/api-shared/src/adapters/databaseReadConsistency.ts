import type { PoolClient, PoolConfig } from "pg";
import type { ApiDatabase, DatabaseSession } from "./types";

/**
 * An assertion by the endpoint owner, not topology discovered from a URL.
 * All traffic for connectionString must go directly to the same writable
 * primary, without a query cache or a read-routing intermediary.
 */
export interface PostgresReadRouting {
  readonly connectionString: string;
  readonly transport: "direct" | "proxy" | "unknown";
  readonly readTarget: "primary" | "replica" | "unknown";
  readonly queryCache: "disabled" | "enabled" | "unknown";
}

type DatabaseReadConsistency = "tracked" | "primary-only";
const consistencyKey = Symbol("databaseReadConsistency");

function hasExplicitEndpoint(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname.length > 0 &&
      url.port.length > 0 &&
      url.username.length > 0 &&
      url.pathname.length > 1 &&
      !["host", "port", "user", "database"].some((key) =>
        url.searchParams.has(key),
      )
    );
  } catch {
    return false;
  }
}

export function databaseReadConsistency(
  executor: DatabaseSession,
): DatabaseReadConsistency {
  return Reflect.get(executor, consistencyKey) === "primary-only"
    ? "primary-only"
    : "tracked";
}

export function postgresReadConsistency(
  config: PoolConfig & { readonly stream?: unknown },
  routing: PostgresReadRouting | undefined,
): {
  readonly read: () => DatabaseReadConsistency;
  readonly verify: ((client: PoolClient) => Promise<void>) | undefined;
} {
  const eligible =
    routing !== undefined &&
    hasExplicitEndpoint(config.connectionString) &&
    routing.connectionString === config.connectionString &&
    config.stream === undefined &&
    routing.transport === "direct" &&
    routing.readTarget === "primary" &&
    routing.queryCache === "disabled";
  const verifiedClients = new WeakSet<PoolClient>();
  let verified = false;
  return {
    read: () => (eligible && verified ? "primary-only" : "tracked"),
    verify: eligible
      ? async (client) => {
          if (verifiedClients.has(client)) return;
          const result = await client.query(
            'select pg_is_in_recovery() as "inRecovery", current_setting(\'transaction_read_only\') as "readOnly"',
          );
          const row = result.rows[0];
          if (row?.inRecovery !== false || row.readOnly !== "off") {
            throw new Error("Primary-only routing requires a writable primary");
          }
          verifiedClients.add(client);
          verified = true;
        }
      : undefined,
  };
}

export function withDatabaseReadConsistency<T extends ApiDatabase>(
  database: T,
  consistency: () => DatabaseReadConsistency,
): T {
  const transaction: ApiDatabase["transaction"] = (callback, config) =>
    database.transaction(
      (tx) => callback(withDatabaseReadConsistency(tx, consistency)),
      config,
    );
  return new Proxy(database, {
    get(target, property) {
      if (property === consistencyKey) return consistency();
      if (property === "transaction") return transaction;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
