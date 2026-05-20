import { afterAll } from "bun:test";
import { type AccessEvent, computeAccessEventHash } from "@tearleads/crypto";
import type {
  DocumentContentKeyTargetEnvelopeResponse,
  EncapsulationKeyResponse,
  ListContainersResponse,
  RegistrationResponse,
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
  get: (key: string) => Promise<string | null>;
  getdel: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
}

function createApiModuleUrl(relativePath: string): string {
  return new URL(`../../../api/src/${relativePath}`, import.meta.url).href;
}

const appTestRuntimeModuleUrl = createApiModuleUrl("appTestRuntime.ts");

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHashString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTimeoutMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isAccessEventType(value: unknown): value is AccessEvent["eventType"] {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(
  value: unknown,
): value is AccessEvent["objectKind"] {
  return value === "blob" || value === "container" || value === "document";
}

function isAccessEvent(value: unknown): value is AccessEvent {
  if (!isRecord(value)) {
    return false;
  }

  const dependencyManifestHashes = Reflect.get(
    value,
    "dependencyManifestHashes",
  );
  const previousManifestHash = Reflect.get(value, "previousManifestHash");

  return (
    Reflect.get(value, "version") === 1 &&
    isNonEmptyString(Reflect.get(value, "eventId")) &&
    isAccessEventType(Reflect.get(value, "eventType")) &&
    isAccessObjectKind(Reflect.get(value, "objectKind")) &&
    isNonEmptyString(Reflect.get(value, "objectId")) &&
    isNonEmptyString(Reflect.get(value, "organizationId")) &&
    (previousManifestHash === null || isHashString(previousManifestHash)) &&
    isStringArray(dependencyManifestHashes) &&
    dependencyManifestHashes.every(isHashString) &&
    isHashString(Reflect.get(value, "bodyHash")) &&
    isNonEmptyString(Reflect.get(value, "signerUserId")) &&
    isNonEmptyString(Reflect.get(value, "signerDeviceId")) &&
    isHashString(Reflect.get(value, "signerKeyFingerprint")) &&
    isNonEmptyString(Reflect.get(value, "signedAt")) &&
    isNonEmptyString(Reflect.get(value, "signature"))
  );
}

function isDocumentContentKeyTargetEnvelopeResponse(
  value: unknown,
): value is DocumentContentKeyTargetEnvelopeResponse {
  if (!isRecord(value)) {
    return false;
  }

  const wrappingMetadata = Reflect.get(value, "wrappingMetadata");

  return (
    isNonEmptyString(Reflect.get(value, "containerId")) &&
    isHashString(Reflect.get(value, "containerManifestHash")) &&
    isNonEmptyString(Reflect.get(value, "containerKeyEpochId")) &&
    isPositiveInteger(Reflect.get(value, "containerKeyEpoch")) &&
    isNonEmptyString(Reflect.get(value, "wrappedKey")) &&
    isRecord(wrappingMetadata)
  );
}

function createSyntheticRootMetadataDocumentResponse(
  rootMetadataDocumentId: string,
): RegistrationResponse["rootMetadataDocument"] {
  const rootContainerId = crypto.randomUUID();
  const manifestHash = randomHex(32);
  const targetHash = randomHex(32);
  const containerKeyEpochId = crypto.randomUUID();

  return {
    id: rootMetadataDocumentId,
    createdAt: new Date().toISOString(),
    accessManifest: {
      event: {
        event: { eventType: "document.link" },
        body: { eventType: "document.link" },
        eventHash: randomHex(32),
      },
      manifest: { objectKind: "document" },
      manifestHash,
      state: { documentId: rootMetadataDocumentId },
    },
    contentKeyBundle: {
      documentId: rootMetadataDocumentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          containerId: rootContainerId,
          containerManifestHash: randomHex(32),
          containerKeyEpochId,
          containerKeyEpoch: 1,
          wrappedKey: randomHex(32),
          wrappingMetadata: { suite: "test" },
        },
      ],
    },
    documentKekTargets: {
      documentId: rootMetadataDocumentId,
      linkSetManifestHash: manifestHash,
      linkedContainerManifestHashes: [randomHex(32)],
      linkedContainerKeyEpochIds: [containerKeyEpochId],
      targets: [{ containerId: rootContainerId }],
      documentKeyTargetHash: targetHash,
    },
  };
}

async function createRootMetadataDocumentResponse(
  requestBody: unknown,
): Promise<RegistrationResponse["rootMetadataDocument"]> {
  if (!isRecord(requestBody)) {
    return createSyntheticRootMetadataDocumentResponse(crypto.randomUUID());
  }

  const documentRequest = Reflect.get(
    requestBody,
    "initialRootMetadataDocument",
  );
  if (!isRecord(documentRequest)) {
    return createSyntheticRootMetadataDocumentResponse(crypto.randomUUID());
  }

  const event = Reflect.get(documentRequest, "event");
  const body = Reflect.get(documentRequest, "body");
  const manifest = Reflect.get(documentRequest, "manifest");
  const contentKeyBundle = Reflect.get(documentRequest, "contentKeyBundle");
  if (
    !isRecord(event) ||
    !isRecord(body) ||
    !isRecord(manifest) ||
    !isRecord(contentKeyBundle)
  ) {
    return createSyntheticRootMetadataDocumentResponse(crypto.randomUUID());
  }

  const containerId = Reflect.get(body, "containerId");
  const manifestHash = Reflect.get(documentRequest, "expectedManifestHash");
  const targetHash = Reflect.get(contentKeyBundle, "targetHash");
  const contentKeyEpoch = Reflect.get(contentKeyBundle, "contentKeyEpoch");
  const rawTargets = Reflect.get(contentKeyBundle, "targets");
  const targets = Array.isArray(rawTargets)
    ? rawTargets.filter(isDocumentContentKeyTargetEnvelopeResponse)
    : [];
  if (
    !isAccessEvent(event) ||
    typeof containerId !== "string" ||
    typeof manifestHash !== "string" ||
    typeof targetHash !== "string" ||
    typeof contentKeyEpoch !== "number" ||
    targets.length === 0
  ) {
    return createSyntheticRootMetadataDocumentResponse(crypto.randomUUID());
  }

  const documentId = event.objectId;
  const organizationId = event.organizationId;
  const eventHash = await computeAccessEventHash(event);
  const kekTargets = targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: new Date().toISOString(),
    accessManifest: {
      event: {
        event,
        body,
        eventHash,
      },
      manifest,
      manifestHash,
      state: {
        version: 1,
        documentId,
        organizationId,
        epoch: 1,
        previousManifestHash: null,
        eventHash,
        linkedContainerIds: [containerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: manifestHash,
      linkedContainerManifestHashes: kekTargets.map((target) =>
        String(target.containerManifestHash),
      ),
      linkedContainerKeyEpochIds: kekTargets.map((target) =>
        String(target.containerKeyEpochId),
      ),
      targets: kekTargets,
      documentKeyTargetHash: targetHash,
    },
  };
}

const server = setupServer(
  eventsSocket.addEventListener("connection", () => {
    // Keep the test socket open; individual tests can add behavior later.
  }),
  http.post("http://localhost:3001/auth/register", async ({ request }) => {
    const requestBody = await request.json().catch(() => null);
    const rootMetadataDocument =
      await createRootMetadataDocumentResponse(requestBody);
    const rootMetadataDocumentId = rootMetadataDocument.id;
    const rootContainerId = isRecord(requestBody)
      ? Reflect.get(requestBody, "rootContainerId")
      : null;

    return HttpResponse.json<RegistrationResponse>({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      rootContainerId:
        typeof rootContainerId === "string"
          ? rootContainerId
          : crypto.randomUUID(),
      rootMetadataDocumentId,
      rootMetadataAccessEpoch: 1,
      rootMetadataAccessStateHash: randomHex(32),
      rootMetadataDocument,
      challenge: randomHex(32),
    });
  }),
  http.post("http://localhost:3001/auth/verify", () => {
    return HttpResponse.json<VerifyResponse>({
      authenticated: true,
      token: randomHex(64),
    });
  }),
  http.get("http://localhost:3001/containers", () => {
    return HttpResponse.json<ListContainersResponse>({
      hasMore: false,
      items: [],
      nextWatermark: null,
      tombstones: [],
    });
  }),
  http.get(
    "http://localhost:3001/containers/:containerId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  http.post("http://localhost:3001/documents", () => {
    return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
  }),
  http.get<{ userId: string }>(
    "http://localhost:3001/auth/encapsulation-key/:userId",
    ({ params }) => {
      return HttpResponse.json<EncapsulationKeyResponse>({
        userId: params.userId,
        signingPublicKey: randomHex(32),
        signingKeyFingerprint: randomHex(32),
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

  // MSW keeps WebSocket clients in its own manager; closing the client does
  // not remove it from eventsSocket.clients in happy-dom/Bun.
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "msw/worker:stop" },
    }),
  );
}

async function drainSocketClients(): Promise<void> {
  // Let component unmount cleanups call ws.close() before forcing shutdown.
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
  const entries = new Map<
    string,
    { expiresAt: number | null; value: string }
  >();

  const getNonExpired = (key: string): string | null => {
    const entry = entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }

    return entry.value;
  };

  return {
    del: async (key: string) => {
      entries.delete(key);
    },
    get: async (key: string) => getNonExpired(key),
    getdel: async (key: string) => {
      const value = getNonExpired(key);
      if (value !== null) {
        entries.delete(key);
      }
      return value;
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

  testProcessState.hasLoadedApiRuntimeModule = true;
  testApiAppPromise = (async () => {
    const [
      {
        createDestroySession,
        createRequireAuth,
        createRouteApp,
        createSessionTokenIssuer,
        db,
      },
    ] = await Promise.all([import(appTestRuntimeModuleUrl)]);

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
    if (!db) {
      throw new Error("API app test runtime module missing db export.");
    }

    const keyValueStore = createInMemoryKeyValueStore();
    const eventPublisher = {
      publish: async (event: Record<string, unknown>) => {
        eventsSocket.broadcast(JSON.stringify(event));
      },
    };
    const runtime = {
      db,
      eventPublisher,
      keyValueStore,
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
  timeoutMs = 500,
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

export async function resetMockServer(
  options: ResetMockServerOptions = {},
): Promise<void> {
  await drainSocketClients();
  await waitForProxiedApiRequestsToSettle(
    options.proxiedApiTimeoutMs,
    options.proxiedApiQuietMs,
  );
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
