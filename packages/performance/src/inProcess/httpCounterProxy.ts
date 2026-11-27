import { normalizeScenarioRoute } from "../scenarios/routeNormalize";

export interface HttpRouteTraffic {
  readonly count: number;
  readonly conflicts: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

export interface HttpWireTraffic {
  readonly requests: number;
  readonly conflicts: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly byRoute: Readonly<Record<string, HttpRouteTraffic>>;
}

interface MutableRouteTraffic {
  count: number;
  conflicts: number;
  requestBytes: number;
  responseBytes: number;
}

export function emptyHttpTraffic(): HttpWireTraffic {
  return {
    requests: 0,
    conflicts: 0,
    requestBytes: 0,
    responseBytes: 0,
    byRoute: {},
  };
}

/** Delta between two snapshots taken on the same counting HTTP proxy. */
export function httpTrafficSince(
  now: HttpWireTraffic,
  before: HttpWireTraffic,
): HttpWireTraffic {
  const byRoute: Record<string, HttpRouteTraffic> = {};
  for (const [route, afterStat] of Object.entries(now.byRoute)) {
    const prev = before.byRoute[route];
    const count = afterStat.count - (prev?.count ?? 0);
    if (count <= 0) continue;
    byRoute[route] = {
      count,
      conflicts: afterStat.conflicts - (prev?.conflicts ?? 0),
      requestBytes: afterStat.requestBytes - (prev?.requestBytes ?? 0),
      responseBytes: afterStat.responseBytes - (prev?.responseBytes ?? 0),
    };
  }
  return {
    requests: now.requests - before.requests,
    conflicts: now.conflicts - before.conflicts,
    requestBytes: now.requestBytes - before.requestBytes,
    responseBytes: now.responseBytes - before.responseBytes,
    byRoute,
  };
}

export interface RequestGate {
  /** Resolves once a matching request has arrived and been paused before upstream. */
  readonly wait: () => Promise<void>;
  /** Lets the paused request proceed upstream. */
  readonly release: () => void;
  /** Removes the gate if not yet hit, or releases it if already waiting. */
  readonly cancel: () => void;
}

export interface HttpCounterProxy {
  readonly origin: string;
  readonly snapshot: () => HttpWireTraffic;
  /** Pauses the next request matching `predicate` before forwarding it upstream. */
  readonly holdBeforeRequest: (
    predicate: (request: {
      readonly method: string;
      readonly pathname: string;
    }) => boolean,
  ) => RequestGate;
  readonly stop: () => Promise<void>;
}

interface PendingGate {
  readonly predicate: (request: {
    readonly method: string;
    readonly pathname: string;
  }) => boolean;
  readonly arrived: () => void;
  readonly released: Promise<void>;
  readonly release: () => void;
  consumed: boolean;
}

function createGateQueue() {
  const gates: PendingGate[] = [];

  const holdBeforeRequest = (
    predicate: (request: {
      readonly method: string;
      readonly pathname: string;
    }) => boolean,
  ): RequestGate => {
    let arrived: () => void = () => undefined;
    const arrivedPromise = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate: PendingGate = {
      predicate,
      arrived,
      released,
      release,
      consumed: false,
    };
    gates.push(gate);
    return {
      wait: () => arrivedPromise,
      release: () => {
        gate.consumed = true;
        release();
      },
      cancel: () => {
        gate.consumed = true;
        const idx = gates.indexOf(gate);
        if (idx >= 0) gates.splice(idx, 1);
        release();
      },
    };
  };

  const pauseIfMatched = async (
    method: string,
    pathname: string,
  ): Promise<void> => {
    const idx = gates.findIndex(
      (gate) => !gate.consumed && gate.predicate({ method, pathname }),
    );
    if (idx < 0) return;
    const [gate] = gates.splice(idx, 1);
    if (!gate) return;
    gate.consumed = true;
    gate.arrived();
    await gate.released;
  };

  const releaseAll = (): void => {
    for (const gate of gates.splice(0)) {
      gate.consumed = true;
      gate.release();
    }
  };

  return { holdBeforeRequest, pauseIfMatched, releaseAll };
}

/**
 * Loopback HTTP proxy in front of the in-process API that counts exact wire
 * requests, 409 conflicts, and request/response body bytes per normalized
 * route without modifying global `fetch`.
 */
const nullBodyStatuses = new Set([101, 204, 205, 304]);

function buildUpstreamUrl(
  upstream: string,
  pathname: string,
  search: string,
): URL {
  const targetUrl = new URL(upstream);
  targetUrl.pathname = pathname;
  targetUrl.search = search;
  return targetUrl;
}

async function forwardRequest(
  request: Request,
  upstream: string,
  gateQueue: ReturnType<typeof createGateQueue>,
  record: (
    route: string,
    status: number,
    reqBytes: number,
    resBytes: number,
  ) => void,
): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  await gateQueue.pauseIfMatched(request.method, pathname);
  const targetUrl = buildUpstreamUrl(upstream, pathname, search);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const reqBuffer = hasBody ? await request.arrayBuffer() : null;
  const reqBytes = reqBuffer?.byteLength ?? 0;
  const forwarded = new Request(targetUrl, {
    method: request.method,
    headers: new Headers(request.headers),
    ...(reqBuffer !== null ? { body: reqBuffer } : {}),
    redirect: request.redirect,
    signal: request.signal,
  });
  const response = await fetch(forwarded, { decompress: false });
  const resBuffer = nullBodyStatuses.has(response.status)
    ? new ArrayBuffer(0)
    : await response.arrayBuffer();
  const route = normalizeScenarioRoute(request.method, pathname);
  record(route, response.status, reqBytes, resBuffer.byteLength);
  return new Response(
    nullBodyStatuses.has(response.status) ? null : resBuffer,
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
}

export function startHttpCounterProxy(upstream: string): HttpCounterProxy {
  let requests = 0;
  let conflicts = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  const routes = new Map<string, MutableRouteTraffic>();
  const gateQueue = createGateQueue();

  const record = (
    route: string,
    status: number,
    reqBytes: number,
    resBytes: number,
  ) => {
    requests += 1;
    if (status === 409) conflicts += 1;
    requestBytes += reqBytes;
    responseBytes += resBytes;
    const entry = routes.get(route) ?? {
      count: 0,
      conflicts: 0,
      requestBytes: 0,
      responseBytes: 0,
    };
    entry.count += 1;
    if (status === 409) entry.conflicts += 1;
    entry.requestBytes += reqBytes;
    entry.responseBytes += resBytes;
    routes.set(route, entry);
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    fetch: (request) => forwardRequest(request, upstream, gateQueue, record),
  });

  return {
    origin: server.url.origin,
    snapshot: () => ({
      requests,
      conflicts,
      requestBytes,
      responseBytes,
      byRoute: Object.fromEntries(
        [...routes.entries()]
          .sort(
            ([aRoute, a], [bRoute, b]) =>
              b.count - a.count ||
              (aRoute < bRoute ? -1 : aRoute > bRoute ? 1 : 0),
          )
          .map(([route, stat]) => [route, { ...stat }]),
      ),
    }),
    holdBeforeRequest: gateQueue.holdBeforeRequest,
    stop: async () => {
      gateQueue.releaseAll();
      await server.stop(true);
    },
  };
}
