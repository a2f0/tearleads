/**
 * Installs a Web Locks stand-in on `navigator`, so this realm's Loro lifetime
 * holds its lock and opens read windows as a browser tab would. Every lock is
 * granted at once, so it suits a test that runs one lifetime. Returns its
 * removal.
 */
export function installFakeWebLocks(): () => void {
  const held = new Set<string>();
  const locks = {
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
    request: async <T>(
      name: string,
      optionsOrCallback: unknown,
      callback?: () => T | Promise<T>,
    ): Promise<T> => {
      const run =
        typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
      if (typeof run !== "function") throw new TypeError("No lock callback");
      held.add(name);
      try {
        return await run();
      } finally {
        held.delete(name);
      }
    },
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: locks,
  });
  return () => {
    Reflect.deleteProperty(navigator, "locks");
  };
}
