export type ApiReachability = "reachable" | "unreachable";

export type ApiReachabilityProbe = (
  apiOrigin: string,
) => Promise<ApiReachability>;

export interface ApiReachabilityProbeOptions {
  /** How long one probe result answers later failures for the same origin. */
  readonly cacheMs?: number | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly timeoutMs?: number | undefined;
}

const DEFAULT_CACHE_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Runs after a request to the API failed without a response, never before.
 * A `no-cors` HEAD of the API origin's root carries no credentials, headers,
 * or body, needs no preflight, and resolves with an opaque response whenever
 * the host answers at all; it rejects on DNS, TLS, connection, or blocked
 * host failures. HEAD leaves opaque-response blocking no body to sniff, so a
 * JSON root cannot turn a healthy answer into an error (Chromium 145 resolves
 * both GET and HEAD against the production API root; an unknown host throws).
 * One probe per origin runs at a time, and its result answers
 * every failure within `cacheMs`, so a burst of failed calls costs one probe.
 */
export function createApiReachabilityProbe(
  options: ApiReachabilityProbeOptions = {},
): ApiReachabilityProbe {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const probes = new Map<
    string,
    { readonly at: number; readonly result: Promise<ApiReachability> }
  >();
  return (apiOrigin) => {
    const cached = probes.get(apiOrigin);
    if (cached && now() - cached.at < cacheMs) return cached.result;
    const result = probeOnce(
      options.fetch ?? globalThis.fetch,
      apiOrigin,
      timeoutMs,
    );
    probes.set(apiOrigin, { at: now(), result });
    return result;
  };
}

async function probeOnce(
  fetchImpl: typeof globalThis.fetch,
  apiOrigin: string,
  timeoutMs: number,
): Promise<ApiReachability> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ApiReachability>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("unreachable");
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(`${apiOrigin}/`, {
        cache: "no-store",
        credentials: "omit",
        method: "HEAD",
        mode: "no-cors",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      }).then(
        (response) => {
          void response.body?.cancel().catch(() => {});
          return "reachable" as const;
        },
        () => "unreachable" as const,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
