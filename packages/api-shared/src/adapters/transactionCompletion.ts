import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "./types";

interface CompletionEffect {
  readonly run: (committed: boolean) => Promise<void>;
  readonly report: (error: unknown) => void;
}

/** Optional cache publication after the outer transaction releases its locks. */
export interface DatabaseTransactionCompletion {
  readonly root: DatabaseSession;
  defer(run: CompletionEffect["run"], report: CompletionEffect["report"]): void;
}

interface TransactionFrame {
  readonly completion: DatabaseTransactionCompletion;
  readonly effects: CompletionEffect[];
}

const completions = new WeakMap<
  DatabaseSession,
  DatabaseTransactionCompletion
>();

export function databaseTransactionCompletion(
  executor: DatabaseSession,
): DatabaseTransactionCompletion | undefined {
  return completions.get(executor);
}

function frame(root: DatabaseSession): TransactionFrame {
  const effects: CompletionEffect[] = [];
  return {
    effects,
    completion: {
      root,
      defer: (run, report) => {
        effects.push({ run, report });
      },
    },
  };
}

function transactionProxy(
  transaction: DatabaseTransaction,
  parent: TransactionFrame,
): DatabaseTransaction {
  const proxy = new Proxy(transaction, {
    get(target, property) {
      if (property === "transaction") {
        return async <T>(
          callback: (nested: DatabaseTransaction) => Promise<T>,
        ) => {
          const child = frame(parent.completion.root);
          let released = false;
          try {
            const result = await target.transaction((nested) =>
              callback(transactionProxy(nested, child)),
            );
            released = true;
            return result;
          } finally {
            // A savepoint release is not a commit. Delay effects until the
            // outer transaction ends, including effects of rolled-back children.
            for (const effect of child.effects)
              parent.effects.push({
                ...effect,
                run: (committed) => effect.run(committed && released),
              });
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  completions.set(proxy, parent.completion);
  return proxy;
}

async function complete(
  frame: TransactionFrame,
  committed: boolean,
): Promise<void> {
  for (const effect of frame.effects) {
    try {
      await effect.run(committed);
    } catch (error) {
      // Optional publication must never turn an already committed mutation
      // into an apparent failure, even if its diagnostic reporter also fails.
      try {
        effect.report(error);
      } catch (reportError) {
        console.error("Transaction completion reporting failed", reportError);
      }
    }
  }
  frame.effects.length = 0;
}

/** Preserve query methods/configuration; add completion scopes to callbacks. */
export function withDatabaseTransactionCompletion(
  database: ApiDatabase,
): ApiDatabase {
  const transaction: ApiDatabase["transaction"] = async (callback, config) => {
    const current = frame(database);
    let committed = false;
    try {
      const result = await database.transaction(
        (tx) => callback(transactionProxy(tx, current)),
        config,
      );
      committed = true;
      return result;
    } finally {
      await complete(current, committed);
    }
  };
  return new Proxy(database, {
    get(target, property) {
      if (property === "transaction") return transaction;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
