import type {
  EncapsulationKeyResponse,
  PublicKeyResponse,
  VerifyResponse,
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

function isClosableConnection(value: unknown): value is ClosableConnection {
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

async function waitForProxiedApiRequestsToDrain(
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (activeProxiedApiRequestCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function resetMockServer(): Promise<void> {
  for (const client of eventsSocket.clients) {
    if (isClosableConnection(client)) {
      client.close();
    }
  }
  await waitForSocketClientsToDrain();
  await waitForProxiedApiRequestsToDrain();
  await closeApiRuntimeConnections();
  server.resetHandlers();
  activeProxiedApiRequestCount = 0;
  proxiedApiRequests.length = 0;
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
  const apiModulePath = ["..", "..", "..", "api", "src", "index"].join("/");
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
    const response = await apiModule.app.fetch(proxiedRequest);
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
