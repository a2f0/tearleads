// RPC surfaces of the Durable Objects, declared without importing their
// implementations so the adapters that call them never depend on the Workers
// runtime modules (which would close an import cycle through the gateway).

/** The Redis subset the API uses, served by `KeyValueStore`. */
export interface KeyValueStoreRpc {
  del(key: string): void;
  expire(key: string, ttlSeconds: number): void;
  get(key: string): string | null;
  getdel(key: string): string | null;
  sadd(key: string, member: string): void;
  set(key: string, value: string, ttlSeconds?: number): void;
  setKeepTtl(key: string, value: string): void;
  smembers(key: string, offset: number): string[];
  srem(key: string, member: string): void;
}

/** The event bus surface of `RealtimeHub`. */
export interface RealtimeHubRpc {
  publish(message: string): void;
}
