import type { KeyValueStoreRpc, RealtimeHubRpc } from "./contracts";

/**
 * The bindings the Worker and its Durable Objects receive from Wrangler. String
 * bindings (vars and secrets) are mirrored into `process.env` so the API's
 * existing configuration readers work unchanged; object bindings stay here.
 */
export interface WorkerBindings {
  readonly KEY_VALUE_STORE: DurableObjectNamespace<KeyValueStoreRpc>;
  readonly REALTIME_HUB: DurableObjectNamespace<RealtimeHubRpc>;
  readonly REALTIME_HUB_LOCATION_HINT?: string | undefined;
  readonly [binding: string]: unknown;
}

const apiDatabaseEnvKey = "API_DATABASE";
const KEY_VALUE_STORE_NAME = "default";
const REALTIME_HUB_NAME = "hub";
const DEFAULT_LOCATION_HINT = "enam";
/** Members per `smembers` page; mirrors the Redis SSCAN batch the API used. */
export const KEY_VALUE_SET_PAGE_SIZE = 100;

let boundEnvironment: WorkerBindings | undefined;
let localRealtimePublisher: ((message: string) => void) | undefined;

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
  // Wrangler replaces process.env.NODE_ENV with "production" at build time.
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
 * Inside the realtime hub, publishing is a local call; a Durable Object must
 * not call its own stub. Everywhere else it is an RPC to the hub.
 */
export function setLocalRealtimePublisher(
  publisher: (message: string) => void,
): void {
  localRealtimePublisher = publisher;
}

export function workerRealtimePublisher():
  | ((message: string) => Promise<void>)
  | undefined {
  if (!boundEnvironment) {
    return undefined;
  }
  return async (message) => {
    if (localRealtimePublisher) {
      localRealtimePublisher(message);
      return;
    }
    await realtimeHubStub().publish(message);
  };
}
