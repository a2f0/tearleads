import { afterAll } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isRegistrationRequest } from "@tearleads/validators/request";
import type {
  DestroySessionResponse,
  ListContainerParentLanesResponse,
  ListSessionsResponse,
  OrganizationBillingResponse,
  UserIdentityResponse,
  VerifyResponse,
} from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import { createMswEventRouter, type MswSocketClient } from "./mswEventRouter";
import { recordUnhandledRequest } from "./unhandledRequests";

export const wsUrl = "ws://localhost:3002";

const eventsSocket = ws.link(wsUrl);
// Socket identity mirrors the production upgrade: the client's ?ticket= is the
// one-time ticket the proxied test API app minted, resolved through the same
// module-level ticket store the API wrote it to. Session liveness is skipped —
// the ticket was minted by an authenticated route moments earlier, and the app
// test runtime keeps sessions in its own in-memory store.
const eventRouter = createMswEventRouter({
  resolveTicketIdentity: async (ticket) => {
    const { createWebSocketTicketConsumer } = (await import(
      appTestRuntimeModuleUrl
    )) as {
      createWebSocketTicketConsumer: (
        validateSession: (identity: {
          sessionId: string;
          userId: string;
        }) => Promise<boolean>,
      ) => (
        ticket: string,
      ) => Promise<{ sessionId: string; userId: string } | null>;
    };
    return createWebSocketTicketConsumer(async () => true)(ticket);
  },
});
const proxiedApiRequests: Array<{
  authorization: string | null;
  method: string;
  requestBody: string | null;
  responseBody: string;
  status: number;
  url: string;
}> = [];

interface ProxiedApiNetworkActivitySnapshot {
  activeRequestCount: number;
  completedRequestCount: number;
}

interface ResetMockServerOptions {
  proxiedApiQuietMs?: number;
  proxiedApiTimeoutMs?: number;
}

interface TestApiAppHandlerOptions {
  responseDelayMs?: number;
}

let activeProxiedApiRequestCount = 0;
let testApiAppPromise: Promise<TestApiApp> | null = null;

interface AppTestProcessState {
  hasLoadedApiRuntimeModule: boolean;
}

interface TestApiKeyValueStore {
  del: (key: string) => Promise<void>;
  expire: (key: string, ttlSeconds: number) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  getdel: (key: string) => Promise<string | null>;
  sadd: (key: string, member: string) => Promise<void>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
  setKeepTtl: (key: string, value: string) => Promise<void>;
  srem: (key: string, member: string) => Promise<void>;
  sscanMembers: (key: string) => AsyncIterable<string[]>;
}

const [appTestRuntimeModuleUrl, apiPostgresAdapterModuleUrl] = [
  "../../../api/src/appTestRuntime.ts",
  "../../../api-shared/src/adapters/postgres.ts",
].map((path) => new URL(path, import.meta.url).href) as [string, string];

const appTestProcessState = globalThis as typeof globalThis & {
  __tearleadsAppTestProcessState?: AppTestProcessState;
};

function getOrCreateTestProcessState(): AppTestProcessState {
  const existing = appTestProcessState.__tearleadsAppTestProcessState;
  if (existing) {
    return existing;
  }

  const created: AppTestProcessState = {
    hasLoadedApiRuntimeModule: false,
  };
  appTestProcessState.__tearleadsAppTestProcessState = created;
  return created;
}

const testProcessState = getOrCreateTestProcessState();

interface TestApiApp {
  fetch: (request: Request) => Promise<Response>;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const mockUserIdentitiesByUserId = new Map<
  string,
  Promise<UserIdentityResponse>
>();
interface MockAuthContext {
  organizationId: string;
  userId: string;
}

let mockAuthContext: MockAuthContext | null = null;

function getMockUserIdentityResponse(
  userId: string,
): Promise<UserIdentityResponse> {
  let response = mockUserIdentitiesByUserId.get(userId);
  if (!response) {
    response = (async () => {
      const signingKeyPair = generateSigningSeedAndKeyPair();
      const encapsulationKeyPair = generateKemSeedAndKeyPair();
      return {
        encapsulationKeyFingerprint: await toFingerprint(
          encapsulationKeyPair.publicKey,
        ),
        userId,
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        signingKeyFingerprint: await toFingerprint(
          signingKeyPair.signingPublicKey,
        ),
        encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
      };
    })();
    mockUserIdentitiesByUserId.set(userId, response);
  }
  return response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTimeoutMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

const emptyListResponse = () =>
  HttpResponse.json({
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  });

const server = setupServer(
  eventsSocket.addEventListener("connection", ({ client }) => {
    eventRouter.handleConnection(client as MswSocketClient);
  }),
  http.post("http://localhost:3001/auth/register", async ({ request }) => {
    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);
    const response = await proxyRequestToApiApp(request);
    if (response.ok && isRegistrationRequest(requestBody)) {
      mockAuthContext = {
        organizationId: requestBody.organizationId,
        userId: requestBody.userId,
      };
    }
    return response;
  }),
  http.post("http://localhost:3001/auth/challenge", () =>
    HttpResponse.json({ challenge: randomHex(32) }),
  ),
  http.post("http://localhost:3001/auth/verify", () => {
    const context = mockAuthContext ?? {
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    mockAuthContext = context;
    return HttpResponse.json<VerifyResponse>({
      authenticated: true,
      organizationId: context.organizationId,
      token: randomHex(64),
      userId: context.userId,
    });
  }),
  http.get("http://localhost:3001/auth/sessions", () => {
    return HttpResponse.json<ListSessionsResponse>({
      sessions: [
        {
          createdAt: "2026-05-22T10:00:00.000Z",
          id: randomHex(32),
          ipAddresses: ["198.51.100.10"],
          isCurrent: true,
          lastActiveAt: "2026-05-22T10:05:00.000Z",
          lastActiveIp: "198.51.100.10",
          signingKeyFingerprint: randomHex(32),
        },
      ],
    });
  }),
  http.delete("http://localhost:3001/auth/sessions/:sessionId", () => {
    return HttpResponse.json<DestroySessionResponse>({ message: "ok" });
  }),
  http.post("http://localhost:3001/auth/logout", () => {
    return HttpResponse.json<DestroySessionResponse>({ message: "ok" });
  }),
  http.post("http://localhost:3001/auth/ws-ticket", () => {
    return HttpResponse.json({ ticket: randomHex(32) });
  }),
  http.get<{ organizationId: string }>(
    "http://localhost:3001/organizations/:organizationId/billing",
    ({ params }) => {
      return HttpResponse.json<OrganizationBillingResponse>({
        organizationId: params.organizationId,
        activeMemberCount: 1,
        status: "trialing",
        trialEndsAt: "2099-01-01T00:00:00.000Z",
        provider: null,
        currentPeriodStartsAt: null,
        currentPeriodEndsAt: null,
        seatCount: 1,
        pendingSeatCount: null,
        disabledAt: null,
        purgeAfter: null,
      });
    },
  ),
  http.post(
    "http://localhost:3001/containers/parent-lanes/query",
    async ({ request }) => {
      const input = (await request.json()) as {
        lanes?: Array<{ laneId?: unknown }> | undefined;
      };
      const lanes = Array.isArray(input.lanes) ? input.lanes : [];
      return HttpResponse.json<ListContainerParentLanesResponse>({
        results: lanes.flatMap((lane) =>
          typeof lane.laneId === "string"
            ? [
                {
                  laneId: lane.laneId,
                  page: {
                    hasMore: false,
                    items: [],
                    nextWatermark: null,
                    tombstones: [],
                  },
                },
              ]
            : [],
        ),
      });
    },
  ),
  http.get(
    "http://localhost:3001/containers/:containerId/documents",
    emptyListResponse,
  ),
  http.get(
    "http://localhost:3001/containers/:containerId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  http.post("http://localhost:3001/documents", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  // Background sync fires from any test that establishes an identity, including
  // the ones that never opt into useTestApiAppHandlers. A success response is not
  // constructible here: isDocumentSyncResponse demands a per-document
  // contentKeyBundle and documentKekTargets that a static handler cannot forge,
  // and a shape-valid fake would still fail write-header signature verification.
  // 401 is the one failure the SDK handles cleanly — it is not refreshable (so no
  // session-refresh replay), and unlike 402/404 it triggers no onPaymentRequired
  // or onRemoteDocumentDeleted side effect. The lane reports and stops.
  http.post("http://localhost:3001/documents/:documentId/sync", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  http.get(
    "http://localhost:3001/documents/:documentId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  http.get<{ userId: string }>(
    "http://localhost:3001/auth/user-identity/:userId",
    async ({ params }) => {
      return HttpResponse.json<UserIdentityResponse>(
        await getMockUserIdentityResponse(params.userId),
      );
    },
  ),
);

server.listen({
  onUnhandledRequest: (request, print) => {
    recordUnhandledRequest(
      `${request.method} ${new URL(request.url).pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/giu, "/:id")}`,
    );
    // print.error() is the "error" strategy's body: log, then throw so the
    // request rejects. happydom.ts asserts on what was recorded at the end of
    // the run. Note a callback is stricter than the "error" string, which
    // exempts asset-shaped URLs (.json, .css, fonts) and lets them escape to the
    // real network — an exemption for browser dev-server noise that this
    // bun/happy-dom suite has no use for.
    print.error();
  },
});

interface ClosableConnection {
  close: (code?: number, reason?: string) => void;
}

function isClosableConnection(value: unknown): value is ClosableConnection {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function"
  );
}

async function waitForSocketClientsToDrain(timeoutMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (eventsSocket.clients.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function clearMswSocketClientStore(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Reset MSW's WebSocket client manager in happy-dom/Bun.
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "msw/worker:stop" },
    }),
  );
}

async function drainSocketClients(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));

  for (const client of eventsSocket.clients) {
    if (isClosableConnection(client)) {
      client.close();
    }
  }

  clearMswSocketClientStore();
  await waitForSocketClientsToDrain();
}

function createInMemoryKeyValueStore(): TestApiKeyValueStore {
  const strings = new Map<
    string,
    { expiresAt: number | null; value: string }
  >();
  const sets = new Map<
    string,
    { expiresAt: number | null; members: Set<string> }
  >();

  const expiresAtFromTtl = (ttlSeconds: number | undefined): number | null =>
    ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;

  const getNonExpired = (key: string): string | null => {
    const entry = strings.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      strings.delete(key);
      return null;
    }

    return entry.value;
  };

  const getNonExpiredSet = (key: string): Set<string> | null => {
    const entry = sets.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      sets.delete(key);
      return null;
    }

    return entry.members;
  };

  return {
    del: async (key: string) => {
      strings.delete(key);
      sets.delete(key);
    },
    expire: async (key: string, ttlSeconds: number) => {
      const expiresAt = expiresAtFromTtl(ttlSeconds);
      const stringEntry = strings.get(key);
      if (stringEntry) {
        stringEntry.expiresAt = expiresAt;
      }
      const setEntry = sets.get(key);
      if (setEntry) {
        setEntry.expiresAt = expiresAt;
      }
    },
    get: async (key: string) => getNonExpired(key),
    getdel: async (key: string) => {
      const value = getNonExpired(key);
      if (value !== null) {
        strings.delete(key);
      }
      return value;
    },
    sadd: async (key: string, member: string) => {
      const members = getNonExpiredSet(key) ?? new Set<string>();
      members.add(member);
      sets.set(key, { expiresAt: sets.get(key)?.expiresAt ?? null, members });
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      strings.set(key, {
        expiresAt: expiresAtFromTtl(ttlSeconds),
        value,
      });
    },
    setKeepTtl: async (key: string, value: string) => {
      if (getNonExpired(key) === null) {
        return;
      }
      const entry = strings.get(key);
      if (!entry) {
        return;
      }
      strings.set(key, {
        expiresAt: entry.expiresAt,
        value,
      });
    },
    srem: async (key: string, member: string) => {
      const members = getNonExpiredSet(key);
      members?.delete(member);
    },
    sscanMembers: async function* (key: string) {
      const members = getNonExpiredSet(key);
      if (!members) {
        return;
      }
      yield Array.from(members);
    },
  };
}

async function ensureTestApiApp(): Promise<TestApiApp> {
  if (testApiAppPromise) {
    return testApiAppPromise;
  }

  testProcessState.hasLoadedApiRuntimeModule = true;
  testApiAppPromise = (async () => {
    const [
      { initializeApiDatabase },
      {
        createDestroySession,
        createDestroyUserSession,
        createListUserSessions,
        createMemoryBlobObjectStore,
        createRequireAuth,
        createRouteApp,
        createSessionTokenIssuer,
        db,
      },
    ] = await Promise.all([
      import(apiPostgresAdapterModuleUrl),
      import(appTestRuntimeModuleUrl),
    ]);

    if (typeof initializeApiDatabase !== "function") {
      throw new Error(
        "API postgres adapter module missing initializeApiDatabase export.",
      );
    }
    if (typeof createRouteApp !== "function") {
      throw new Error("API routeApp module missing createRouteApp export.");
    }
    if (typeof createDestroySession !== "function") {
      throw new Error(
        "API session module missing createDestroySession export.",
      );
    }
    if (typeof createDestroyUserSession !== "function") {
      throw new Error(
        "API session module missing createDestroyUserSession export.",
      );
    }
    if (typeof createListUserSessions !== "function") {
      throw new Error(
        "API session module missing createListUserSessions export.",
      );
    }
    if (typeof createMemoryBlobObjectStore !== "function") {
      throw new Error(
        "API app test runtime module missing createMemoryBlobObjectStore export.",
      );
    }
    if (typeof createRequireAuth !== "function") {
      throw new Error("API session module missing createRequireAuth export.");
    }
    if (typeof createSessionTokenIssuer !== "function") {
      throw new Error(
        "API session module missing createSessionTokenIssuer export.",
      );
    }
    if (!db) {
      throw new Error("API app test runtime module missing db export.");
    }

    await initializeApiDatabase();

    const keyValueStore = createInMemoryKeyValueStore();
    const eventPublisher = {
      publish: async (event: Record<string, unknown>) => {
        await eventRouter.publish(event);
      },
    };
    const runtime = {
      blobObjectStore: createMemoryBlobObjectStore(),
      db,
      eventPublisher,
      keyValueStore,
      sessionTokenIssuer: {
        createSession: createSessionTokenIssuer(
          keyValueStore.set,
          keyValueStore.sadd,
          keyValueStore.expire,
        ),
      },
    };
    const routeApp = createRouteApp({
      destroySession: createDestroySession(
        keyValueStore.get,
        keyValueStore.del,
        keyValueStore.srem,
      ),
      destroyUserSession: createDestroyUserSession(
        keyValueStore.get,
        keyValueStore.del,
        keyValueStore.srem,
      ),
      listUserSessions: createListUserSessions(
        keyValueStore.get,
        keyValueStore.srem,
        keyValueStore.sscanMembers,
      ),
      publish: (event: Record<string, unknown>) =>
        eventPublisher.publish(event),
      requireAuth: createRequireAuth(
        keyValueStore.get,
        keyValueStore.setKeepTtl,
      ),
      runtime,
    });

    return {
      fetch: (request: Request) => routeApp.fetch(request),
    };
  })();

  return testApiAppPromise;
}

async function waitForProxiedApiRequestsToDrain(
  deadline: number,
): Promise<void> {
  while (activeProxiedApiRequestCount > 0) {
    const remainingMs = remainingTimeoutMs(deadline);
    if (remainingMs <= 0) {
      return;
    }

    await delay(Math.min(10, remainingMs));
  }
}

async function waitForProxiedApiNetworkIdle(
  timeoutMs = 500,
  quietMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastRequestCount = proxiedApiRequests.length;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    await waitForProxiedApiRequestsToDrain(deadline);

    const nextRequestCount = proxiedApiRequests.length;
    if (
      activeProxiedApiRequestCount === 0 &&
      nextRequestCount === lastRequestCount
    ) {
      if (Date.now() - quietStartedAt >= quietMs) {
        return true;
      }
    } else {
      lastRequestCount = nextRequestCount;
      quietStartedAt = Date.now();
    }

    const remainingMs = remainingTimeoutMs(deadline);
    if (remainingMs <= 0) {
      break;
    }

    await delay(Math.min(10, remainingMs));
  }

  return false;
}

export function getProxiedApiNetworkActivitySnapshot(): ProxiedApiNetworkActivitySnapshot {
  return {
    activeRequestCount: activeProxiedApiRequestCount,
    completedRequestCount: proxiedApiRequests.length,
  };
}

async function waitForProxiedApiRequestsToSettle(
  timeoutMs = 2_000,
  quietMs = 50,
): Promise<void> {
  const settled = await waitForProxiedApiNetworkIdle(timeoutMs, quietMs);
  if (settled) {
    return;
  }

  const activity = getProxiedApiNetworkActivitySnapshot();
  throw new Error(
    `Timed out waiting for proxied API network idle before resetting mock server. activeRequests=${activity.activeRequestCount}, completedRequests=${activity.completedRequestCount}, timeoutMs=${timeoutMs}, quietMs=${quietMs}`,
  );
}

function quoteSqlIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unexpected API test table name: ${identifier}`);
  }

  return `"${identifier}"`;
}

async function resetTestApiDatabase(): Promise<void> {
  if (!testApiAppPromise) {
    return;
  }

  const [{ initializeApiDatabase }, { db }] = await Promise.all([
    import(apiPostgresAdapterModuleUrl),
    import(appTestRuntimeModuleUrl),
  ]);
  if (typeof initializeApiDatabase !== "function") {
    throw new Error(
      "API postgres adapter module missing initializeApiDatabase export.",
    );
  }
  if (!db) {
    throw new Error("API app test runtime module missing db export.");
  }

  await initializeApiDatabase();

  const tableResult = await db.execute(sql<{ tableName: string }>`
    select tablename as "tableName"
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename <> '__drizzle_migrations'
    order by tablename
  `);
  const tableNames = tableResult.rows.map(
    (row: { tableName: string }) => row.tableName,
  );
  if (tableNames.length === 0) {
    return;
  }

  await db.execute(
    sql.raw(
      `truncate table ${tableNames.map(quoteSqlIdentifier).join(", ")} restart identity cascade`,
    ),
  );
}

export async function resetMockServer(
  options: ResetMockServerOptions = {},
): Promise<void> {
  await drainSocketClients();
  await waitForProxiedApiRequestsToSettle(
    options.proxiedApiTimeoutMs,
    options.proxiedApiQuietMs,
  );
  await resetTestApiDatabase();
  testApiAppPromise = null;
  activeProxiedApiRequestCount = 0;
  mockAuthContext = null;
  mockUserIdentitiesByUserId.clear();
  eventRouter.clear();
  proxiedApiRequests.length = 0;
  server.resetHandlers();
}

export function listProxiedApiRequests(): ReadonlyArray<{
  authorization: string | null;
  method: string;
  requestBody: string | null;
  responseBody: string;
  status: number;
  url: string;
}> {
  return [...proxiedApiRequests];
}

function toHeadersObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers as unknown as Iterable<[string, string]>);
}

async function proxyRequestToApiApp(
  request: Request,
  options: TestApiAppHandlerOptions = {},
): Promise<Response> {
  const apiApp = await ensureTestApiApp();
  activeProxiedApiRequestCount += 1;
  try {
    const requestBody =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : await request.arrayBuffer();
    const proxiedRequest =
      request.method === "GET" || request.method === "HEAD"
        ? new Request(request.url, {
            method: request.method,
            headers: request.headers,
          })
        : new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: requestBody,
          });
    const response = await apiApp.fetch(proxiedRequest);
    if (options.responseDelayMs !== undefined && options.responseDelayMs > 0) {
      await delay(options.responseDelayMs);
    }

    const responseBody = await response.text();
    proxiedApiRequests.push({
      authorization: request.headers.get("authorization"),
      method: request.method,
      requestBody:
        requestBody === null
          ? null
          : new TextDecoder().decode(new Uint8Array(requestBody)),
      responseBody,
      status: response.status,
      url: request.url,
    });

    return new HttpResponse(responseBody, {
      status: response.status,
      headers: toHeadersObject(response.headers),
    });
  } finally {
    activeProxiedApiRequestCount -= 1;
  }
}

export function useTestApiAppHandlers(options: TestApiAppHandlerOptions = {}) {
  server.use(
    http.all("http://localhost:3001/*", async ({ request }) =>
      proxyRequestToApiApp(request, options),
    ),
  );
}

afterAll(async () => {
  await resetMockServer();
});
