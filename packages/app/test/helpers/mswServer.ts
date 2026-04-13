import { afterAll } from "bun:test";
import type {
  EncapsulationKeyResponse,
  PublicKeyResponse,
  VerifyResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import type { ApiServiceRuntime } from "../../../api/src/services/runtime";

export const wsUrl = "ws://localhost:3002";

const eventsSocket = ws.link(wsUrl);
const proxiedApiRequests: Array<{
  authorization: string | null;
  method: string;
  requestBody: string | null;
  responseBody: string;
  status: number;
  url: string;
}> = [];
let activeProxiedApiRequestCount = 0;
let hasLoadedApiRuntimeModule = false;
let testApiAppPromise: Promise<TestApiApp> | null = null;

const routeAppModulePath = ["..", "..", "..", "api", "src", "routeApp"].join(
  "/",
);
const sessionModulePath = [
  "..",
  "..",
  "..",
  "api",
  "src",
  "middleware",
  "session",
].join("/");
const postgresModulePath = [
  "..",
  "..",
  "..",
  "api",
  "src",
  "adapters",
  "postgres",
].join("/");

interface TestApiApp {
  fetch: (request: Request) => Promise<Response>;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const server = setupServer(
  eventsSocket.addEventListener("connection", () => {
    // Keep the test socket open; individual tests can add behavior later.
  }),
  http.post("http://localhost:3001/auth/register", () => {
    return HttpResponse.json<PublicKeyResponse>({
      message: "ok",
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      rootContainerId: crypto.randomUUID(),
      rootMetadataDocumentId: crypto.randomUUID(),
      rootMetadataAccessEpoch: 1,
      rootMetadataRecipientEncapsulationPublicKeys: [randomHex(32)],
      challenge: randomHex(32),
    });
  }),
  http.post("http://localhost:3001/auth/verify", () => {
    return HttpResponse.json<VerifyResponse>({
      authenticated: true,
      token: randomHex(64),
    });
  }),
  http.post("http://localhost:3001/documents", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  http.get<{ userId: string }>(
    "http://localhost:3001/auth/encapsulation-key/:userId",
    ({ params }) => {
      return HttpResponse.json<EncapsulationKeyResponse>({
        userId: params.userId,
        encapsulationPublicKey: randomHex(32),
      });
    },
  ),
);

server.listen();

interface ClosableConnection {
  close: (code?: number, reason?: string) => void;
}

interface AsyncClosable {
  close: () => Promise<void> | void;
}

function isClosableConnection(value: unknown): value is ClosableConnection {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function"
  );
}

function isAsyncClosable(value: unknown): value is AsyncClosable {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function"
  );
}

async function waitForSocketClientsToDrain(timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (eventsSocket.clients.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function drainSocketClients(): Promise<void> {
  // Let component unmount cleanups call ws.close() before forcing shutdown.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await waitForSocketClientsToDrain(250);

  if (eventsSocket.clients.size === 0) {
    return;
  }

  for (const client of eventsSocket.clients) {
    if (isClosableConnection(client)) {
      client.close();
    }
  }

  await waitForSocketClientsToDrain();
}

function createInMemoryKeyValueStore(): ApiServiceRuntime["keyValueStore"] {
  const entries = new Map<
    string,
    { expiresAt: number | null; value: string }
  >();

  return {
    del: async (key: string) => {
      entries.delete(key);
    },
    get: async (key: string) => {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }

      return entry.value;
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      entries.set(key, {
        expiresAt:
          ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
        value,
      });
    },
  };
}

async function ensureTestApiApp(): Promise<TestApiApp> {
  if (testApiAppPromise) {
    return testApiAppPromise;
  }

  hasLoadedApiRuntimeModule = true;
  testApiAppPromise = (async () => {
    const [
      { createRouteApp },
      { createDestroySession, createRequireAuth, createSessionTokenIssuer },
      { db },
    ] = await Promise.all([
      import(routeAppModulePath),
      import(sessionModulePath),
      import(postgresModulePath),
    ]);

    if (typeof createRouteApp !== "function") {
      throw new Error("API routeApp module missing createRouteApp export.");
    }
    if (typeof createDestroySession !== "function") {
      throw new Error(
        "API session module missing createDestroySession export.",
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

    const keyValueStore = createInMemoryKeyValueStore();
    const eventPublisher: ApiServiceRuntime["eventPublisher"] = {
      publish: async (event: Record<string, unknown>) => {
        eventsSocket.broadcast(JSON.stringify(event));
      },
    };
    const runtime: ApiServiceRuntime = {
      db,
      eventPublisher,
      keyValueStore,
      principalSignerTrustStore: {
        getTrustedSignerPublicKey: async () => null,
      },
      sessionTokenIssuer: {
        createSession: createSessionTokenIssuer(keyValueStore.set),
      },
    };
    const routeApp = createRouteApp({
      destroySession: createDestroySession(keyValueStore.del),
      publish: (event: Record<string, unknown>) =>
        eventPublisher.publish(event),
      requireAuth: createRequireAuth(keyValueStore.get),
      runtime,
    });

    return {
      fetch: (request: Request) => routeApp.fetch(request),
    };
  })();

  return testApiAppPromise;
}

async function waitForProxiedApiRequestsToDrain(
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (activeProxiedApiRequestCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function resetMockServer(): Promise<void> {
  await drainSocketClients();
  await waitForProxiedApiRequestsToDrain();
  testApiAppPromise = null;
  activeProxiedApiRequestCount = 0;
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
  const nextHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    nextHeaders[key] = value;
  });
  return nextHeaders;
}

async function proxyRequestToApiApp(request: Request): Promise<Response> {
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

export function useRealApiHandlers() {
  server.use(
    http.all("http://localhost:3001/*", async ({ request }) =>
      proxyRequestToApiApp(request),
    ),
  );
}

afterAll(async () => {
  await resetMockServer();

  if (!hasLoadedApiRuntimeModule) {
    return;
  }

  const { default: postgresClient } = await import(postgresModulePath);
  if (isAsyncClosable(postgresClient)) {
    await postgresClient.close();
  }
});
