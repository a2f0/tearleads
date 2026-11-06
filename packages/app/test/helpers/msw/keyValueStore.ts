export interface TestApiKeyValueStore {
  del: (key: string) => Promise<void>;
  expire: (key: string, ttlSeconds: number) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  getdel: (key: string) => Promise<string | null>;
  sadd: (key: string, member: string) => Promise<void>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
  setKeepTtl: (key: string, value: string) => Promise<void>;
  srem: (key: string, member: string) => Promise<void>;
  sscanMembers: (key: string) => AsyncIterable<string[]>;
}

export function createInMemoryKeyValueStore(): TestApiKeyValueStore {
  const strings = new Map<
    string,
    { expiresAt: number | null; value: string }
  >();
  const sets = new Map<
    string,
    { expiresAt: number | null; members: Set<string> }
  >();

  const expiresAtFromTtl = (ttlSeconds: number | undefined): number | null =>
    ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;

  const getNonExpired = (key: string): string | null => {
    const entry = strings.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      strings.delete(key);
      return null;
    }

    return entry.value;
  };

  const getNonExpiredSet = (key: string): Set<string> | null => {
    const entry = sets.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      sets.delete(key);
      return null;
    }

    return entry.members;
  };

  return {
    del: async (key: string) => {
      strings.delete(key);
      sets.delete(key);
    },
    expire: async (key: string, ttlSeconds: number) => {
      const expiresAt = expiresAtFromTtl(ttlSeconds);
      const stringEntry = strings.get(key);
      if (stringEntry) {
        stringEntry.expiresAt = expiresAt;
      }
      const setEntry = sets.get(key);
      if (setEntry) {
        setEntry.expiresAt = expiresAt;
      }
    },
    get: async (key: string) => getNonExpired(key),
    getdel: async (key: string) => {
      const value = getNonExpired(key);
      if (value !== null) {
        strings.delete(key);
      }
      return value;
    },
    sadd: async (key: string, member: string) => {
      const members = getNonExpiredSet(key) ?? new Set<string>();
      members.add(member);
      sets.set(key, { expiresAt: sets.get(key)?.expiresAt ?? null, members });
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      strings.set(key, {
        expiresAt: expiresAtFromTtl(ttlSeconds),
        value,
      });
    },
    setKeepTtl: async (key: string, value: string) => {
      if (getNonExpired(key) === null) {
        return;
      }
      const entry = strings.get(key);
      if (!entry) {
        return;
      }
      strings.set(key, {
        expiresAt: entry.expiresAt,
        value,
      });
    },
    srem: async (key: string, member: string) => {
      const members = getNonExpiredSet(key);
      members?.delete(member);
    },
    sscanMembers: async function* (key: string) {
      const members = getNonExpiredSet(key);
      if (!members) {
        return;
      }
      yield Array.from(members);
    },
  };
}
