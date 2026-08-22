import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";

export function gateTransactionExecuteAfterExecution(input: {
  readonly database: ApiDatabase;
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
          let executeCount = 0;
          const gatedTx = new Proxy(tx, {
            get(transaction, txProperty) {
              const txValue = Reflect.get(transaction, txProperty, transaction);
              if (txProperty !== "execute" || typeof txValue !== "function") {
                return typeof txValue === "function"
                  ? txValue.bind(transaction)
                  : txValue;
              }
              return async (...args: unknown[]) => {
                const result = await txValue.apply(transaction, args);
                executeCount += 1;
                if (executeCount === input.occurrence) {
                  input.reached();
                  await input.release;
                }
                return result;
              };
            },
          }) as DatabaseTransaction;
          return callback(gatedTx);
        });
    },
  }) as ApiDatabase;
}
