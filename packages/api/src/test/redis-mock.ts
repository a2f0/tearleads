type RedisValue = string | string[] | Set<string> | Record<string, string>;

type RedisErrorHandler = (error: Error) => void;
type RedisMessageHandler = (message: string, channel: string) => void;

type ScanOptions = {
  MATCH?: string;
  COUNT?: number;
};

interface RedisMultiMock {
  type: (key: string) => RedisMultiMock;
  ttl: (key: string) => RedisMultiMock;
  exec: () => Promise<Array<string | number | null | undefined>>;
}

interface RedisMockClient {
  connect: () => Promise<void>;
  quit: () => Promise<void>;
  on: (event: string, handler: RedisErrorHandler) => RedisMockClient;
  emitError: (error: Error) => void;
  duplicate: () => RedisMockClient;
  subscribe: (channel: string, handler: RedisMessageHandler) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  publish: (channel: string, message: string) => Promise<number>;
  scan: (
    cursor: string | number,
    options?: ScanOptions
  ) => Promise<{ cursor: number; keys: string[] }>;
  multi: () => RedisMultiMock;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<'OK'>;
  sAdd: (key: string, members: string | string[]) => Promise<number>;
  sRem: (key: string, member: string) => Promise<number>;
  hSet: (key: string, entries: Record<string, string>) => Promise<number>;
  rPush: (key: string, values: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  type: (key: string) => Promise<string>;
  ttl: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  sMembers: (key: string) => Promise<string[]>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  del: (key: string) => Promise<number>;
  dbSize: () => Promise<number>;
}

type PubSubState = {
  handlers: Map<string, Set<RedisMessageHandler>>;
};

type StoreState = {
  values: Map<string, RedisValue>;
  ttl: Map<string, number>;
};

const createStoreState = (): StoreState => ({
  values: new Map(),
  ttl: new Map()
});

const createPubSubState = (): PubSubState => ({
  handlers: new Map()
});

const getValueType = (value: RedisValue | undefined): string => {
  if (!value) {
    return 'none';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  if (Array.isArray(value)) {
    return 'list';
  }

  if (value instanceof Set) {
    return 'set';
  }

  return 'hash';
};

const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(`^${withWildcards}$`);
};

const matchesPattern = (key: string, pattern?: string): boolean => {
  if (!pattern || pattern === '*') {
    return true;
  }

  return patternToRegex(pattern).test(key);
};

const createClientWithState = (
  store: StoreState,
  pubSub: PubSubState
): RedisMockClient => {
  const errorHandlers: RedisErrorHandler[] = [];

  const client: RedisMockClient = {
    connect: async () => {},
    quit: async () => {},
    on: (event, handler) => {
      if (event === 'error') {
        errorHandlers.push(handler);
      }
      return client;
    },
    emitError: (error) => {
      for (const handler of errorHandlers) {
        handler(error);
      }
    },
    duplicate: () => createClientWithState(store, pubSub),
    subscribe: async (channel, handler) => {
      const existing = pubSub.handlers.get(channel);
      if (existing) {
        existing.add(handler);
      } else {
        pubSub.handlers.set(channel, new Set([handler]));
      }
    },
    unsubscribe: async (channel) => {
      pubSub.handlers.delete(channel);
    },
    publish: async (channel, message) => {
      const handlers = pubSub.handlers.get(channel);
      if (!handlers) {
        return 0;
      }

      for (const handler of handlers) {
        handler(message, channel);
      }

      return handlers.size;
    },
    scan: async (_cursor, options) => {
      const cursor = Number(_cursor) || 0;
      const keys = Array.from(store.values.keys()).filter((key) =>
        matchesPattern(key, options?.MATCH)
      );
      const count = options?.COUNT ?? keys.length;
      const page = keys.slice(cursor, cursor + count);
      const nextCursor = cursor + page.length;
      return { cursor: nextCursor < keys.length ? nextCursor : 0, keys: page };
    },
    multi: () => {
      const commands: Array<() => Promise<string | number | null | undefined>> =
        [];

      const chain: RedisMultiMock = {
        type: (key) => {
          commands.push(async () => client.type(key));
          return chain;
        },
        ttl: (key) => {
          commands.push(async () => client.ttl(key));
          return chain;
        },
        exec: async () => {
          const results: Array<string | number | null | undefined> = [];
          for (const command of commands) {
            results.push(await command());
          }
          return results;
        }
      };

      return chain;
    },
    set: async (key, value, options) => {
      store.values.set(key, value);
      if (options?.EX) {
        store.ttl.set(key, options.EX);
      }
      return 'OK';
    },
    sAdd: async (key, members) => {
      const existing = store.values.get(key);
      const set = existing instanceof Set ? existing : new Set<string>();
      const sizeBefore = set.size;
      const memberArray = Array.isArray(members) ? members : [members];
      for (const member of memberArray) {
        set.add(member);
      }
      store.values.set(key, set);
      return set.size - sizeBefore;
    },
    sRem: async (key, member) => {
      const existing = store.values.get(key);
      if (!(existing instanceof Set)) {
        return 0;
      }
      const existed = existing.delete(member);
      return existed ? 1 : 0;
    },
    hSet: async (key, entries) => {
      const existing = store.values.get(key);
      const record =
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        !(existing instanceof Set)
          ? { ...existing }
          : {};
      let newEntries = 0;
      for (const [field, value] of Object.entries(entries)) {
        if (!(field in record)) {
          newEntries += 1;
        }
        record[field] = value;
      }
      store.values.set(key, record);
      return newEntries;
    },
    rPush: async (key, values) => {
      const existing = store.values.get(key);
      const list = Array.isArray(existing) ? existing : [];
      list.push(...values);
      store.values.set(key, list);
      return list.length;
    },
    expire: async (key, seconds) => {
      if (!store.values.has(key)) {
        return 0;
      }
      store.ttl.set(key, seconds);
      return 1;
    },
    type: async (key) => getValueType(store.values.get(key)),
    ttl: async (key) => store.ttl.get(key) ?? -1,
    get: async (key) => {
      const value = store.values.get(key);
      return typeof value === 'string' ? value : null;
    },
    sMembers: async (key) => {
      const value = store.values.get(key);
      if (value instanceof Set) {
        return Array.from(value);
      }
      return [];
    },
    hGetAll: async (key) => {
      const value = store.values.get(key);
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Set)
      ) {
        return value;
      }
      return {};
    },
    del: async (key) => {
      const existed = store.values.delete(key);
      store.ttl.delete(key);
      return existed ? 1 : 0;
    },
    dbSize: async () => store.values.size
  };

  return client;
};

export const createClient = (): RedisMockClient => {
  const store = createStoreState();
  const pubSub = createPubSubState();
  return createClientWithState(store, pubSub);
};
