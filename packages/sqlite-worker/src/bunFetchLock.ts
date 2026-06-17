// Serializes SQLite WASM loads under Bun. Bun-only state, isolated here so the
// loader module stays focused on VFS/database concerns.
let sqliteInitQueue = Promise.resolve();

function getBunFetch(): typeof fetch | null {
  return typeof Bun === "undefined" ? null : Bun.fetch;
}

/**
 * Run `operation` with `globalThis.fetch` temporarily routed through `Bun.fetch`
 * (a no-op outside Bun). The generated SQLite/Emscripten loader calls bare
 * `fetch()` while loading `sqlite3.wasm`; under Bun that needs `Bun.fetch`, and
 * the swap must be serialized so concurrent loads cannot see each other's
 * patched global. Outside Bun the operation runs directly.
 */
export function runWithBunFetchLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const bunFetch = getBunFetch();
  if (!bunFetch) {
    return operation();
  }

  const nextOperation = sqliteInitQueue.then(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = bunFetch;

    try {
      return await operation();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  sqliteInitQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}
