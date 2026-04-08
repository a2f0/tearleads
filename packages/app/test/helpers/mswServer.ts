import { afterAll } from "bun:test";
import {
  isChallengeRequest,
  isCreateContainerRequest,
  isPublicKeyRequest,
  isShareContainerRequest,
  isVerifyRequest,
} from "@tearleads/validators/request";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
  CreateContainerResponse,
  EncapsulationKeyResponse,
  ListContainerDocumentsResponse,
  ListContainersResponse,
  PublicKeyResponse,
  ShareContainerResponse,
  VerifyResponse,
} from "@tearleads/validators/response";
import {
  isChallengeErrorResponse,
  isChallengeResponse,
  isCreateContainerResponse,
  isEncapsulationKeyResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isPublicKeyResponse,
  isShareContainerResponse,
  isVerifyResponse,
} from "@tearleads/validators/response";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";

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
const inMemoryKeyValueEntries = new Map<
  string,
  { expiresAt: number | null; value: string }
>();
const inMemorySessions = new Map<
  string,
  { createdAt: number; fingerprint: string; userId: string }
>();

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

async function closeApiRuntimeConnections(): Promise<void> {
  const redisModulePath = [
    "..",
    "..",
    "..",
    "api",
    "src",
    "adapters",
    "redis",
  ].join("/");
  const redisPubSubModulePath = [
    "..",
    "..",
    "..",
    "api",
    "src",
    "adapters",
    "redisPubSub",
  ].join("/");
  const [{ closeRedisClient }, { closeRedisPubSub }] = await Promise.all([
    import(redisModulePath),
    import(redisPubSubModulePath),
  ]);

  await closeRedisPubSub();
  await closeRedisClient();
}

function clearInMemoryServiceRuntime(): void {
  inMemoryKeyValueEntries.clear();
  inMemorySessions.clear();
}

function getInMemoryValue(key: string): string | null {
  const entry = inMemoryKeyValueEntries.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    inMemoryKeyValueEntries.delete(key);
    return null;
  }

  return entry.value;
}

async function loadApiModule(pathParts: string[]): Promise<unknown> {
  hasLoadedApiRuntimeModule = true;
  return import(pathParts.join("/"));
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : null;
}

function getFunctionFromModule(
  moduleValue: unknown,
  exportName: string,
): ((...args: unknown[]) => Promise<unknown>) | null {
  if (typeof moduleValue !== "object" || moduleValue === null) {
    return null;
  }

  const exportValue = Reflect.get(moduleValue, exportName);
  return typeof exportValue === "function" ? exportValue : null;
}

function getStringParam(
  params: Record<string, string | readonly string[] | undefined>,
  key: string,
): string | null {
  const value = Reflect.get(params, key);
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNumberProperty(
  value: Record<string, unknown>,
  key: string,
): number | null {
  const propertyValue = Reflect.get(value, key);
  return typeof propertyValue === "number" ? propertyValue : null;
}

function getUnknownProperty(
  value: Record<string, unknown>,
  key: string,
): unknown {
  return Reflect.get(value, key);
}

function isChallengeServiceBody(
  value: unknown,
): value is ChallengeErrorResponse | ChallengeResponse {
  return isChallengeErrorResponse(value) || isChallengeResponse(value);
}

function getValidatedResponseBody<T>(
  result: unknown,
  guard: (value: unknown) => value is T,
  context: string,
): T {
  if (!guard(result)) {
    throw new Error(`${context} returned invalid response body.`);
  }

  return result;
}

function getValidatedResult<T>(
  result: unknown,
  bodyGuard: (value: unknown) => value is T,
  context: string,
): { body: T; status: number } {
  if (!isRecord(result)) {
    throw new Error(`${context} returned invalid result.`);
  }

  const status = getNumberProperty(result, "status");
  if (status === null) {
    throw new Error(`${context} result missing numeric status.`);
  }

  const body = getUnknownProperty(result, "body");
  if (!bodyGuard(body)) {
    throw new Error(`${context} result body failed validation.`);
  }

  return { body, status };
}

async function createInMemoryApiServiceRuntime() {
  const [postgresModule, sessionModule] = await Promise.all([
    loadApiModule(["..", "..", "..", "api", "src", "adapters", "postgres"]),
    loadApiModule(["..", "..", "..", "api", "src", "middleware", "session"]),
  ]);
  if (!isRecord(postgresModule) || !("db" in postgresModule)) {
    throw new Error("API postgres module missing db export.");
  }
  const createSession = getFunctionFromModule(sessionModule, "createSession");
  if (!createSession) {
    throw new Error("API session module missing createSession export.");
  }
  const db = Reflect.get(postgresModule, "db");

  return {
    db,
    eventPublisher: {
      publish: async (event: Record<string, unknown>) => {
        eventsSocket.broadcast(JSON.stringify(event));
      },
    },
    keyValueStore: {
      del: async (key: string) => {
        inMemoryKeyValueEntries.delete(key);
      },
      get: async (key: string) => getInMemoryValue(key),
      set: async (key: string, value: string, ttlSeconds?: number) => {
        inMemoryKeyValueEntries.set(key, {
          expiresAt:
            ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
          value,
        });
      },
    },
    sessionTokenIssuer: {
      createSession: async (data: {
        createdAt: number;
        fingerprint: string;
        userId: string;
      }) => {
        const issuedToken = await createSession(data);
        if (typeof issuedToken !== "string") {
          throw new Error("API createSession returned invalid token.");
        }
        const token = issuedToken;
        inMemorySessions.set(token, data);
        return token;
      },
    },
  };
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7);
}

function getAuthenticatedSession(
  request: Request,
): { createdAt: number; fingerprint: string; userId: string } | null {
  const token = extractBearerToken(request);
  if (!token) {
    return null;
  }

  return inMemorySessions.get(token) ?? null;
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
  await closeApiRuntimeConnections();
  clearInMemoryServiceRuntime();
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
  const apiModulePath = ["..", "..", "..", "api", "src", "routeApp"].join("/");
  const apiModule = await import(apiModulePath);
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
    const response = await apiModule.routeApp.fetch(proxiedRequest);
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
    http.post("http://localhost:3001/auth/register", async ({ request }) => {
      const body: unknown = await request.json();
      if (!isPublicKeyRequest(body)) {
        return HttpResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const runtime = await createInMemoryApiServiceRuntime();
      const moduleValue = await loadApiModule([
        "..",
        "..",
        "..",
        "api",
        "src",
        "services",
        "auth",
        "registerPublicKey",
      ]);
      const registerPublicKey = getFunctionFromModule(
        moduleValue,
        "registerPublicKey",
      );
      if (!registerPublicKey) {
        throw new Error("registerPublicKey export not found.");
      }

      try {
        const response = await registerPublicKey(runtime, body);
        return HttpResponse.json<PublicKeyResponse>(
          getValidatedResponseBody(
            response,
            isPublicKeyResponse,
            "registerPublicKey",
          ),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "REGISTER_DUPLICATE_FINGERPRINT"
        ) {
          return HttpResponse.json(
            { error: "Key already exists" },
            { status: 409 },
          );
        }
        const status = getErrorStatus(error);
        if (error instanceof Error && status !== null) {
          return HttpResponse.json({ error: error.message }, { status });
        }

        throw error;
      }
    }),
    http.post("http://localhost:3001/auth/challenge", async ({ request }) => {
      const body: unknown = await request.json();
      if (!isChallengeRequest(body)) {
        return HttpResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const runtime = await createInMemoryApiServiceRuntime();
      const moduleValue = await loadApiModule([
        "..",
        "..",
        "..",
        "api",
        "src",
        "services",
        "auth",
        "createChallenge",
      ]);
      const createChallenge = getFunctionFromModule(
        moduleValue,
        "createChallenge",
      );
      if (!createChallenge) {
        throw new Error("createChallenge export not found.");
      }
      const result = getValidatedResult(
        await createChallenge(runtime, body),
        isChallengeServiceBody,
        "createChallenge",
      );
      return HttpResponse.json(result.body, {
        status: result.status,
      });
    }),
    http.post("http://localhost:3001/auth/verify", async ({ request }) => {
      const body: unknown = await request.json();
      if (!isVerifyRequest(body)) {
        return HttpResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const runtime = await createInMemoryApiServiceRuntime();
      const moduleValue = await loadApiModule([
        "..",
        "..",
        "..",
        "api",
        "src",
        "services",
        "auth",
        "verifyChallenge",
      ]);
      const verifyChallenge = getFunctionFromModule(
        moduleValue,
        "verifyChallenge",
      );
      if (!verifyChallenge) {
        throw new Error("verifyChallenge export not found.");
      }
      const result = getValidatedResult(
        await verifyChallenge(runtime, body),
        isVerifyResponse,
        "verifyChallenge",
      );
      return HttpResponse.json<VerifyResponse>(result.body, {
        status: result.status,
      });
    }),
    http.get(
      "http://localhost:3001/auth/encapsulation-key/:userId",
      async ({ params, request }) => {
        const session = getAuthenticatedSession(request);
        if (!session) {
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const runtime = await createInMemoryApiServiceRuntime();
        const userId = getStringParam(params, "userId");
        if (!userId) {
          return HttpResponse.json(
            { error: "User not found" },
            { status: 404 },
          );
        }
        const moduleValue = await loadApiModule([
          "..",
          "..",
          "..",
          "api",
          "src",
          "services",
          "auth",
          "getEncapsulationKey",
        ]);
        const getEncapsulationKey = getFunctionFromModule(
          moduleValue,
          "getEncapsulationKey",
        );
        if (!getEncapsulationKey) {
          throw new Error("getEncapsulationKey export not found.");
        }

        try {
          const response = getValidatedResponseBody(
            await getEncapsulationKey(runtime, userId),
            isEncapsulationKeyResponse,
            "getEncapsulationKey",
          );
          return HttpResponse.json<EncapsulationKeyResponse>(response);
        } catch (error) {
          const status = getErrorStatus(error);
          if (error instanceof Error && status !== null) {
            return HttpResponse.json({ error: error.message }, { status });
          }

          throw error;
        }
      },
    ),
    http.post("http://localhost:3001/containers", async ({ request }) => {
      const session = getAuthenticatedSession(request);
      if (!session) {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const body: unknown = await request.json();
      if (!isCreateContainerRequest(body)) {
        return HttpResponse.json({ error: "Invalid request" }, { status: 400 });
      }

      const runtime = await createInMemoryApiServiceRuntime();
      const moduleValue = await loadApiModule([
        "..",
        "..",
        "..",
        "api",
        "src",
        "services",
        "containers",
        "createContainer",
      ]);
      const createContainer = getFunctionFromModule(
        moduleValue,
        "createContainer",
      );
      if (!createContainer) {
        throw new Error("createContainer export not found.");
      }

      try {
        const response = getValidatedResponseBody(
          await createContainer(runtime, {
            ...body,
            createdByFingerprint: session.fingerprint,
            userId: session.userId,
          }),
          isCreateContainerResponse,
          "createContainer",
        );
        return HttpResponse.json<CreateContainerResponse>(response);
      } catch (error) {
        const status = getErrorStatus(error);
        if (error instanceof Error && status !== null) {
          return HttpResponse.json({ error: error.message }, { status });
        }

        throw error;
      }
    }),
    http.get("http://localhost:3001/containers", async ({ request }) => {
      const session = getAuthenticatedSession(request);
      if (!session) {
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const runtime = await createInMemoryApiServiceRuntime();
      const moduleValue = await loadApiModule([
        "..",
        "..",
        "..",
        "api",
        "src",
        "services",
        "containers",
        "listContainers",
      ]);
      const listContainers = getFunctionFromModule(
        moduleValue,
        "listContainers",
      );
      if (!listContainers) {
        throw new Error("listContainers export not found.");
      }

      return HttpResponse.json<ListContainersResponse>(
        getValidatedResponseBody(
          await listContainers(runtime, session.userId),
          isListContainersResponse,
          "listContainers",
        ),
      );
    }),
    http.post(
      "http://localhost:3001/containers/:containerId/share",
      async ({ params, request }) => {
        const session = getAuthenticatedSession(request);
        if (!session) {
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body: unknown = await request.json();
        if (!isShareContainerRequest(body)) {
          return HttpResponse.json(
            { error: "Invalid request" },
            { status: 400 },
          );
        }

        const runtime = await createInMemoryApiServiceRuntime();
        const containerId = getStringParam(params, "containerId");
        if (!containerId) {
          return HttpResponse.json(
            { error: "Container not found" },
            { status: 404 },
          );
        }
        const moduleValue = await loadApiModule([
          "..",
          "..",
          "..",
          "api",
          "src",
          "services",
          "containers",
          "shareContainer",
        ]);
        const shareContainer = getFunctionFromModule(
          moduleValue,
          "shareContainer",
        );
        if (!shareContainer) {
          throw new Error("shareContainer export not found.");
        }

        try {
          const response = getValidatedResponseBody(
            await shareContainer(runtime, {
              ...body,
              containerId,
              userId: session.userId,
            }),
            isShareContainerResponse,
            "shareContainer",
          );
          return HttpResponse.json<ShareContainerResponse>(response);
        } catch (error) {
          const status = getErrorStatus(error);
          if (error instanceof Error && status !== null) {
            return HttpResponse.json({ error: error.message }, { status });
          }

          throw error;
        }
      },
    ),
    http.get(
      "http://localhost:3001/containers/:containerId/documents",
      async ({ params, request }) => {
        const session = getAuthenticatedSession(request);
        if (!session) {
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const runtime = await createInMemoryApiServiceRuntime();
        const containerId = getStringParam(params, "containerId");
        if (!containerId) {
          return HttpResponse.json(
            { error: "Container not found" },
            { status: 404 },
          );
        }
        const moduleValue = await loadApiModule([
          "..",
          "..",
          "..",
          "api",
          "src",
          "services",
          "containers",
          "listContainerDocuments",
        ]);
        const listContainerDocuments = getFunctionFromModule(
          moduleValue,
          "listContainerDocuments",
        );
        if (!listContainerDocuments) {
          throw new Error("listContainerDocuments export not found.");
        }

        try {
          const response = getValidatedResponseBody(
            await listContainerDocuments(runtime, containerId, session.userId),
            isListContainerDocumentsResponse,
            "listContainerDocuments",
          );
          return HttpResponse.json<ListContainerDocumentsResponse>(response);
        } catch (error) {
          const status = getErrorStatus(error);
          if (error instanceof Error && status !== null) {
            return HttpResponse.json({ error: error.message }, { status });
          }

          throw error;
        }
      },
    ),
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

  const postgresModule = await loadApiModule([
    "..",
    "..",
    "..",
    "api",
    "src",
    "adapters",
    "postgres",
  ]);
  if (!isRecord(postgresModule)) {
    return;
  }

  const postgresClient = Reflect.get(postgresModule, "default");
  if (isAsyncClosable(postgresClient)) {
    await postgresClient.close();
  }
});
