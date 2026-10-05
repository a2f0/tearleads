// Observe completed database round trips and transferred rows, including
// subqueries built by Drizzle, without replacing SQL execution with fixtures.
export function observeQueries<T extends object>(
  target: T,
  rows: unknown[][],
): T {
  return new Proxy(target, {
    get(value, key, receiver) {
      const member: unknown = Reflect.get(value, key, receiver);
      if (typeof member !== "function") return member;
      if (key === "then") {
        return (resolve: (result: unknown[]) => unknown, reject: unknown) =>
          Reflect.apply(member, value, [
            (result: unknown[]) => {
              rows.push(result);
              return resolve(result);
            },
            reject,
          ]);
      }
      return (...args: unknown[]) => {
        const next: unknown = Reflect.apply(member, value, args);
        return typeof next === "object" && next !== null
          ? observeQueries(next, rows)
          : next;
      };
    },
  });
}

import type { ApiDatabase } from "@tearleads/api-shared/postgres";

/** Observe selected fields through an injected database, including proxies. */
export function observeDatabaseSelects(database: ApiDatabase) {
  const selections: unknown[] = [];
  return {
    selections,
    database: new Proxy(database, {
      get(target, key, receiver) {
        const member: unknown = Reflect.get(target, key, receiver);
        if (key !== "select" || typeof member !== "function") return member;
        return (...args: unknown[]) => {
          selections.push(args[0]);
          return Reflect.apply(member, target, args);
        };
      },
    }),
  };
}
