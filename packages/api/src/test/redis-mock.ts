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
  duplicate: () => RedisMockClient;
  subscribe: (channel: string, handler: RedisMessageHandler) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  scan: (
    cursor: string | number,
    options?: ScanOptions
  ) => Promise<{ cursor: number; keys: string[] }>;
  multi: () => RedisMultiMock;
  type: (key: string) => Promise<string>;
  ttl: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  sMembers: (key: string) => Promise<string[]>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  del: (key: string) => Promise<number>;
  dbSize: () => Promise<number>;
}

type PubSubState = {
  handlers: Map<string, RedisMessageHandler>;
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
    duplicate: () => createClientWithState(store, pubSub),
    subscribe: async (channel, handler) => {
      pubSub.handlers.set(channel, handler);
    },
    unsubscribe: async (channel) => {
      pubSub.handlers.delete(channel);
    },
    scan: async (_cursor, options) => {
      const keys = Array.from(store.values.keys());
      const count = options?.COUNT ?? keys.length;
      const limited = keys.slice(0, count);
      return { cursor: 0, keys: limited };
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
