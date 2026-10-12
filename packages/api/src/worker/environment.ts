import type { KeyValueStoreRpc, RealtimeHubRpc } from "./contracts";

/**
 * The bindings the Worker and its Durable Objects receive from Wrangler. String
 * bindings (vars and secrets) are mirrored into `process.env` so the API's
 * existing configuration readers work unchanged; object bindings stay here.
 */
export interface WorkerBindings {
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly API_WORKER_LOCAL?: string;
  readonly KEY_VALUE_STORE: DurableObjectNamespace<KeyValueStoreRpc>;
  readonly REALTIME_HUB: DurableObjectNamespace<RealtimeHubRpc>;
  readonly REALTIME_HUB_LOCATION_HINT?: string | undefined;
  readonly [binding: string]: unknown;
}

const apiDatabaseEnvKey = "API_DATABASE";
const databaseUrlKey = "DATABASE_URL";
const postgresSslKey = "POSTGRES_SSL";
const nodeEnvKey = "NODE_ENV";
const KEY_VALUE_STORE_NAME = "default";
const REALTIME_HUB_NAME = "hub";
const DEFAULT_LOCATION_HINT = "enam";
/** Members per `smembers` page; mirrors the Redis SSCAN batch the API used. */
export const KEY_VALUE_SET_PAGE_SIZE = 100;

let boundEnvironment: WorkerBindings | undefined;

/**
 * Bind this isolate to its Wrangler environment. Idempotent per environment
 * object; the first call must precede importing any module that reads
 * configuration at import time (the database pool, the blob store, Sentry).
 */
export function bindWorkerEnvironment(env: WorkerBindings): void {
  if (boundEnvironment === env) {
    return;
  }
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[name] = value;
    }
  }
  if (env.HYPERDRIVE) {
    // Hyperdrive supplies edge credentials, not the PlanetScale login. Its
    // origin TLS policy belongs to the Terraform configuration. pg connects
    // to the local Hyperdrive socket without STARTTLS.
    process.env[databaseUrlKey] = env.HYPERDRIVE.connectionString;
    process.env[postgresSslKey] = "false";
  } else if (env.API_WORKER_LOCAL !== "true") {
    throw new Error("The deployed API Worker requires HYPERDRIVE");
  }
  // Wrangler replaces the literal `process.env.NODE_ENV` at build time, but
  // readers that take an environment object see the real `process.env`; a
  // Worker is always a production deployment, so the strict settings (no
  // development HMAC key, origins required, https) apply here too. A binding
  // can still set it explicitly.
  process.env[nodeEnvKey] ??= "production";
  process.env[apiDatabaseEnvKey] ??= "postgres";
  boundEnvironment = env;
}

export function isWorkerEnvironment(): boolean {
  return boundEnvironment !== undefined;
}

function requireBindings(): WorkerBindings {
  if (!boundEnvironment) {
    throw new Error("The Worker environment has not been bound");
  }
  return boundEnvironment;
}

export function keyValueStoreStub(): DurableObjectStub<KeyValueStoreRpc> {
  const bindings = requireBindings();
  return bindings.KEY_VALUE_STORE.get(
    bindings.KEY_VALUE_STORE.idFromName(KEY_VALUE_STORE_NAME),
    { locationHint: locationHint(bindings) },
  );
}

export function realtimeHubStub(): DurableObjectStub<RealtimeHubRpc> {
  const bindings = requireBindings();
  return bindings.REALTIME_HUB.get(
    bindings.REALTIME_HUB.idFromName(REALTIME_HUB_NAME),
    { locationHint: locationHint(bindings) },
  );
}

function locationHint(bindings: WorkerBindings): string {
  return bindings.REALTIME_HUB_LOCATION_HINT?.trim() || DEFAULT_LOCATION_HINT;
}

/**
 * Every publish is an RPC into the hub, even when the hub shares this
 * isolate: only the hub's own request context may drive its sockets, so a
 * module-level shortcut that called into the hub instance directly closed
 * nothing. Nothing inside the hub publishes, so the hub never calls its own
 * stub.
 */
export function workerRealtimePublisher():
  | ((message: string) => Promise<void>)
  | undefined {
  if (!boundEnvironment) {
    return undefined;
  }
  return async (message) => {
    await realtimeHubStub().publish(message);
  };
}
