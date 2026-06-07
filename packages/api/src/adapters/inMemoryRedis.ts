type EventListener = (message: string) => void;

interface StringEntry {
  expiresAt: number | null;
  value: string;
}

interface SetEntry {
  expiresAt: number | null;
  members: Set<string>;
}

const stringEntries = new Map<string, StringEntry>();
const setEntries = new Map<string, SetEntry>();
const listeners = new Set<EventListener>();
const apiRedisEnvKey = "API_REDIS";

function ttlExpiresAt(ttlSeconds: number | undefined): number | null {
  return ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
}

function isExpired(entry: { expiresAt: number | null }): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}

function getStringEntry(key: string): StringEntry | null {
  const entry = stringEntries.get(key);
  if (!entry) {
    return null;
  }

  if (isExpired(entry)) {
    stringEntries.delete(key);
    return null;
  }

  return entry;
}

function getSetEntry(key: string): SetEntry | null {
  const entry = setEntries.get(key);
  if (!entry) {
    return null;
  }

  if (isExpired(entry)) {
    setEntries.delete(key);
    return null;
  }

  return entry;
}

function deleteKey(key: string): void {
  stringEntries.delete(key);
  setEntries.delete(key);
}

export function isInMemoryRedisEnabled(): boolean {
  return process.env[apiRedisEnvKey] === "memory";
}

export async function inMemoryRedisGet(key: string): Promise<string | null> {
  return getStringEntry(key)?.value ?? null;
}

export async function inMemoryRedisSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  setEntries.delete(key);
  stringEntries.set(key, {
    expiresAt: ttlExpiresAt(ttlSeconds),
    value,
  });
}

export async function inMemoryRedisSetKeepTtl(
  key: string,
  value: string,
): Promise<void> {
  const entry = getStringEntry(key);
  if (!entry) {
    return;
  }

  entry.value = value;
}

export async function inMemoryRedisGetDel(key: string): Promise<string | null> {
  const value = getStringEntry(key)?.value ?? null;
  stringEntries.delete(key);
  return value;
}

export async function inMemoryRedisDel(key: string): Promise<void> {
  deleteKey(key);
}

export async function inMemoryRedisExpire(
  key: string,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = ttlExpiresAt(ttlSeconds);
  const stringEntry = getStringEntry(key);
  if (stringEntry) {
    stringEntry.expiresAt = expiresAt;
    return;
  }

  const setEntry = getSetEntry(key);
  if (setEntry) {
    setEntry.expiresAt = expiresAt;
  }
}

export async function inMemoryRedisSadd(
  key: string,
  member: string,
): Promise<void> {
  stringEntries.delete(key);

  const entry = getSetEntry(key);
  if (entry) {
    entry.members.add(member);
    return;
  }

  setEntries.set(key, {
    expiresAt: null,
    members: new Set([member]),
  });
}

export async function inMemoryRedisSrem(
  key: string,
  member: string,
): Promise<void> {
  const entry = getSetEntry(key);
  if (!entry) {
    return;
  }

  entry.members.delete(member);
  if (entry.members.size === 0) {
    setEntries.delete(key);
  }
}

export async function* inMemoryRedisSscanMembers(
  key: string,
): AsyncGenerator<string[], void, unknown> {
  const entry = getSetEntry(key);
  if (!entry) {
    return;
  }

  const members = Array.from(entry.members);
  for (let start = 0; start < members.length; start += 100) {
    yield members.slice(start, start + 100);
  }
}

export async function inMemoryRedisPublish(
  event: Record<string, unknown>,
): Promise<void> {
  const message = JSON.stringify(event);
  for (const listener of listeners) {
    listener(message);
  }
}

export function inMemoryRedisAddListener(listener: EventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearInMemoryRedisData(): void {
  stringEntries.clear();
  setEntries.clear();
}

export function clearInMemoryRedisPubSub(): void {
  listeners.clear();
}
