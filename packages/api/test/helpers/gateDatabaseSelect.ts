import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";

function gateSelectBuilder<T extends object>(
  builder: T,
  afterExecution: (query: T) => Promise<void>,
  proxies = new WeakMap<object, object>(),
): T {
  const existing = proxies.get(builder);
  if (existing) {
    return existing as T;
  }
  const proxy = new Proxy(builder, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, target);
      if (property === "then" && typeof value === "function") {
        return (
          onFulfilled: (result: unknown) => unknown,
          onRejected: (error: unknown) => unknown,
        ) =>
          value.call(
            target,
            async (result: unknown) => {
              await afterExecution(target);
              return onFulfilled(result);
            },
            onRejected,
          );
      }
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (
          result !== null &&
          typeof result === "object" &&
          typeof Reflect.get(result, "then", result) === "function"
        ) {
          return gateSelectBuilder(result, afterExecution, proxies);
        }
        return result === target ? receiver : result;
      };
    },
  });
  proxies.set(builder, proxy);
  return proxy;
}

export function gateTransactionSelectAfterExecution(input: {
  readonly database: ApiDatabase;
  readonly matchesSql: (sql: string) => boolean;
  readonly occurrence: number;
  readonly reached: () => void;
  readonly release: Promise<void>;
}): ApiDatabase {
  return new Proxy(input.database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (callback: (tx: DatabaseTransaction) => Promise<unknown>) =>
        value.call(target, (tx: DatabaseTransaction) => {
          let matchCount = 0;
          const gatedTx = new Proxy(tx, {
            get(transaction, txProperty) {
              const txValue = Reflect.get(transaction, txProperty, transaction);
              if (txProperty !== "select" || typeof txValue !== "function") {
                return typeof txValue === "function"
                  ? txValue.bind(transaction)
                  : txValue;
              }
              return (...args: unknown[]) =>
                gateSelectBuilder(
                  txValue.apply(transaction, args) as object,
                  async (query) => {
                    const toSql = Reflect.get(query, "toSQL", query);
                    if (typeof toSql !== "function") {
                      return;
                    }
                    const sql = String(toSql.call(query).sql);
                    if (!input.matchesSql(sql)) {
                      return;
                    }
                    matchCount += 1;
                    if (matchCount === input.occurrence) {
                      input.reached();
                      await input.release;
                    }
                  },
                );
            },
          }) as DatabaseTransaction;
          return callback(gatedTx);
        });
    },
  }) as ApiDatabase;
}
