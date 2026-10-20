import {
  isWorkerEnvironment,
  KEY_VALUE_SET_PAGE_SIZE,
  keyValueStoreStub,
} from "../worker/environment";
import {
  clearInMemoryKeyValueStore,
  inMemoryDel,
  inMemoryExpire,
  inMemoryGet,
  inMemoryGetDel,
  inMemorySadd,
  inMemorySet,
  inMemorySetKeepTtl,
  inMemorySrem,
  inMemorySscanMembers,
} from "./inMemoryKeyValueStore";

// Two backends share this key/value surface: the SQLite Durable Object on
// Workers, and the in-memory store for the local Bun server and tests. The
// Durable Object serializes every call, so the atomic operations (GETDEL,
// SET XX KEEPTTL) hold there as they do in one process.

export async function get(key: string): Promise<string | null> {
  if (isWorkerEnvironment()) {
    return keyValueStoreStub().get(key);
  }
  return inMemoryGet(key);
}

export async function set(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().set(key, value, ttlSeconds);
    return;
  }
  await inMemorySet(key, value, ttlSeconds);
}

export async function setKeepTtl(key: string, value: string): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().setKeepTtl(key, value);
    return;
  }
  await inMemorySetKeepTtl(key, value);
}

export async function getdel(key: string): Promise<string | null> {
  if (isWorkerEnvironment()) {
    return keyValueStoreStub().getdel(key);
  }
  return inMemoryGetDel(key);
}

export async function del(key: string): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().del(key);
    return;
  }
  await inMemoryDel(key);
}

export async function expire(key: string, ttlSeconds: number): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().expire(key, ttlSeconds);
    return;
  }
  await inMemoryExpire(key, ttlSeconds);
}

export async function sadd(key: string, member: string): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().sadd(key, member);
    return;
  }
  await inMemorySadd(key, member);
}

export async function srem(key: string, member: string): Promise<void> {
  if (isWorkerEnvironment()) {
    await keyValueStoreStub().srem(key, member);
    return;
  }
  await inMemorySrem(key, member);
}

/** The page reader the Durable Object exposes over RPC. */
export interface WorkerSetMemberPages {
  smembers(key: string, after: string | null): Promise<string[]>;
}

/**
 * Page a set by member cursor. Callers prune members while iterating (session
 * listing drops expired sessions), so an offset would skip live members.
 */
export async function* collectWorkerSetMembers(
  store: WorkerSetMemberPages,
  key: string,
  pageSize = KEY_VALUE_SET_PAGE_SIZE,
): AsyncGenerator<string[], void, unknown> {
  let after: string | null = null;
  for (;;) {
    const page = await store.smembers(key, after);
    if (page.length === 0) {
      return;
    }
    yield page;
    const last = page[page.length - 1];
    if (page.length < pageSize || last === undefined) {
      return;
    }
    after = last;
  }
}

// Stream set members in bounded batches. This keeps session listing scoped to
// one user's set without materializing the full set or scanning the keyspace.
export async function* sscanMembers(
  key: string,
): AsyncGenerator<string[], void, unknown> {
  if (isWorkerEnvironment()) {
    yield* collectWorkerSetMembers(keyValueStoreStub(), key);
    return;
  }
  yield* inMemorySscanMembers(key);
}

/** Drop every in-memory entry; tests reset between files. */
export function resetKeyValueStore(): void {
  clearInMemoryKeyValueStore();
}
