import { afterAll } from "bun:test";
import {
  type AccessEvent,
  computeAccessEventHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  DestroySessionResponse,
  DocumentContentKeyTargetEnvelopeResponse,
  EncapsulationKeyResponse,
  ListContainersResponse,
  ListSessionsResponse,
  RegistrationResponse,
  VerifyResponse,
} from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
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

const mockEncapsulationKeysByUserId = new Map<
  string,
  Promise<EncapsulationKeyResponse>
>();
let mockAuthContext: { organizationId: string; userId: string } | null = null;

function getMockEncapsulationKeyResponse(
  userId: string,
): Promise<EncapsulationKeyResponse> {
  let response = mockEncapsulationKeysByUserId.get(userId);
  if (!response) {
    response = (async () => {
      const signingKeyPair = generateSigningSeedAndKeyPair();
      const encapsulationKeyPair = generateKemSeedAndKeyPair();
      return {
        userId,
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        signingKeyFingerprint: await toFingerprint(
          signingKeyPair.signingPublicKey,
        ),
        encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
      };
    })();
    mockEncapsulationKeysByUserId.set(userId, response);
  }
  return response;
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
    const context = {
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    mockAuthContext = context;
    return HttpResponse.json<RegistrationResponse>({
      userId: context.userId,
      organizationId: context.organizationId,
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
  http.get(
    "http://localhost:3001/documents/:documentId/writer-projection",
    () => {
      return HttpResponse.json({ error: "Not Found" }, { status: 404 });
    },
  ),
  http.get<{ userId: string }>(
    "http://localhost:3001/auth/encapsulation-key/:userId",
    async ({ params }) => {
      return HttpResponse.json<EncapsulationKeyResponse>(
        await getMockEncapsulationKeyResponse(params.userId),
      );
    },
  ),
);

server.listen({ onUnhandledRequest: "error" });

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
        eventsSocket.broadcast(JSON.stringify(event));
      },
    };
    const runtime = {
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
  mockEncapsulationKeysByUserId.clear();
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
