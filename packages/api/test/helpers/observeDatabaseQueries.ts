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
