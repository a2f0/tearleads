// Serializes SQLite WASM loads under Bun. Bun-only state, isolated here so the
// loader module stays focused on VFS/database concerns.
let sqliteInitQueue = Promise.resolve();

function getBunFetch(): typeof fetch | null {
  return typeof Bun === "undefined" ? null : Bun.fetch;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * The fetch installed while `operation` runs: the loader's `file:` asset goes
 * through `Bun.fetch`, and every other request keeps the fetch it replaced.
 * The swap is process-wide and the operation is async, so unrelated requests
 * (an app's API calls, or a test's mocked network) can land in its window.
 */
function sqliteAssetFetch(
  bunFetch: typeof fetch,
  previousFetch: typeof fetch,
): typeof fetch {
  return Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      requestUrl(input).startsWith("file:")
        ? bunFetch(input, init)
        : previousFetch(input, init),
    { preconnect: previousFetch.preconnect },
  );
}

/**
 * Run `operation` with `globalThis.fetch` temporarily routing `file:` URLs
 * through `Bun.fetch` (a no-op outside Bun). The generated SQLite/Emscripten
 * loader calls bare `fetch()` on a `file:` URL while loading `sqlite3.wasm`;
 * under Bun that needs `Bun.fetch`, and the swap must be serialized so
 * concurrent loads cannot see each other's patched global. Outside Bun the
 * operation runs directly.
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
    globalThis.fetch = sqliteAssetFetch(bunFetch, previousFetch);

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
