import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { db } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";

interface QueryHook {
  readonly before?: (query: string, tx: DatabaseTransaction) => Promise<void>;
  readonly after?: (query: string, tx: DatabaseTransaction) => Promise<void>;
}

// Gates surround real Drizzle execution; no SQL or result is substituted.
function observeBuilder<T extends object>(
  builder: T,
  hook: QueryHook,
  tx: DatabaseTransaction,
): T {
  return new Proxy(builder, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "then") {
        return (
          resolve: (result: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => {
          const execute = async () => {
            const toSql = Reflect.get(target, "toSQL");
            if (typeof toSql !== "function")
              throw new Error("Expected SQL builder");
            const query = String(toSql.call(target).sql);
            await hook.before?.(query, tx);
            const result = await Reflect.apply(value, target, [
              (rows: unknown) => rows,
            ]);
            await hook.after?.(query, tx);
            return result;
          };
          return execute().then(resolve, reject);
        };
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return result !== null && typeof result === "object"
          ? observeBuilder(result, hook, tx)
          : result;
      };
    },
  });
}

export function probeTransactions(database: ApiDatabase, hook: QueryHook = {}) {
  const started = Promise.withResolvers<number>();
  let finished = false;
  const observed = new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "transaction") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (callback: (tx: DatabaseTransaction) => Promise<unknown>) =>
        target
          .transaction(async (tx) => {
            const result = await tx.execute(
              sql`select pg_backend_pid() as pid`,
            );
            const pid = Number(Reflect.get(result.rows[0] ?? {}, "pid"));
            if (!Number.isInteger(pid))
              throw new Error("Expected PostgreSQL backend pid");
            started.resolve(pid);
            const wrapped = new Proxy(tx, {
              get(transaction, key) {
                const member = Reflect.get(transaction, key, transaction);
                if (typeof member !== "function") return member;
                if (key !== "insert" && key !== "update")
                  return member.bind(transaction);
                return (...args: unknown[]) => {
                  const builder: unknown = Reflect.apply(
                    member,
                    transaction,
                    args,
                  );
                  if (builder === null || typeof builder !== "object")
                    throw new Error("Expected query builder");
                  return observeBuilder(builder, hook, tx);
                };
              },
            });
            return callback(wrapped);
          })
          .finally(() => {
            finished = true;
          });
    },
  });
  return {
    database: observed,
    started: started.promise,
    finished: () => finished,
  };
}

export function queryGate(matches: (query: string) => boolean) {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let arrived = false;
  return {
    arrived: () => arrived,
    reached: reached.promise,
    waitFor: (operation: Promise<unknown>) =>
      Promise.race([
        reached.promise,
        operation.then(() => {
          throw new Error("Operation finished before reaching its SQL gate");
        }),
      ]),
    release: released.resolve,
    hook: async (query: string) => {
      if (!matches(query)) return;
      arrived = true;
      reached.resolve();
      await released.promise;
    },
  };
}

// Terminate on an observed lock wait OR actual application progress, so a
// missing lock and an exclusive lock fail assertions rather than timing out.
export async function observeTransactionProgress(input: {
  readonly pid: number;
  readonly progressed: () => boolean;
  readonly finished: () => boolean;
}) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select pid, state, wait_event_type, query, pg_blocking_pids(pid) as blockers
      from pg_stat_activity where datname = current_database() and pid = ${input.pid}
    `);
    const activity = result.rows[0];
    const blockers: unknown = Reflect.get(activity ?? {}, "blockers");
    const outcome = input.progressed()
      ? "progressed"
      : input.finished()
        ? "finished"
        : Array.isArray(blockers) && blockers.length > 0
          ? "blocked"
          : undefined;
    if (outcome) {
      console.info(
        "stage-lock-evidence",
        JSON.stringify({ outcome, activity }),
      );
      return { outcome, activity };
    }
    await Bun.sleep(10);
  }
  throw new Error(
    `No transaction progress or lock wait observed for backend ${input.pid}`,
  );
}
