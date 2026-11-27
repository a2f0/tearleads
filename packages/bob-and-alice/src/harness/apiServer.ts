import {
  createRouteApp,
  getDefaultApiServiceRuntime,
  initializeApiDatabase,
} from "@tearleads/api/test-runtime";
import { trace } from "./trace";

let origin: Promise<string> | undefined;

const httpSinkKey = "__tearleadsPerfScenarioHttpSink";

interface ScenarioHttpObservation {
  readonly authorization: string | null;
  readonly durationMs: number;
  readonly knownManifestsCount: number;
  readonly method: string;
  readonly requestBody: string | null;
  readonly requestBodyBytes: number;
  readonly responseBody: string;
  readonly responseBodyBytes: number;
  readonly status: number;
  readonly url: string;
}

type ScenarioHttpSink = (observation: ScenarioHttpObservation) => void;

function activeHttpSink(): ScenarioHttpSink | null {
  const sink: unknown = Reflect.get(globalThis, httpSinkKey);
  return typeof sink === "function" ? (sink as ScenarioHttpSink) : null;
}

function countKnownManifests(header: string | null): number {
  if (!header) return 0;
  return header
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;
}

function isUncompressedJson(headers: Headers): boolean {
  return (
    !headers.has("content-encoding") &&
    (headers.get("content-type") ?? "").includes("application/json")
  );
}

/** Traces each refused request with the API's error body. */
async function serve(
  routeApp: ReturnType<typeof createRouteApp>,
  request: Request,
): Promise<Response> {
  const sink = activeHttpSink();
  let requestBytes = 0;
  let requestBody: string | null = null;
  if (sink && request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.clone().arrayBuffer();
    requestBytes = raw.byteLength;
    if (requestBytes > 0 && isUncompressedJson(request.headers)) {
      requestBody = new TextDecoder().decode(raw);
    }
  }
  const startedAt = sink ? performance.now() : 0;
  const response = await routeApp.fetch(request);
  const durationMs = sink ? performance.now() - startedAt : 0;
  if (sink) {
    const rawResponse = await response.clone().arrayBuffer();
    const responseBody =
      rawResponse.byteLength > 0 && isUncompressedJson(response.headers)
        ? new TextDecoder().decode(rawResponse)
        : "";
    sink({
      authorization: request.headers.get("authorization"),
      durationMs,
      knownManifestsCount: countKnownManifests(
        request.headers.get("x-known-manifests"),
      ),
      method: request.method,
      requestBody,
      requestBodyBytes: requestBytes,
      responseBody,
      responseBodyBytes: rawResponse.byteLength,
      status: response.status,
      url: request.url,
    });
  }
  if (response.status >= 400) {
    const body = await response.clone().text();
    const { pathname } = new URL(request.url);
    trace(`${request.method} ${pathname} ${response.status} ${body}`);
  }
  return response;
}

/**
 * One real API per test process, over real HTTP: every device talks to it
 * through the SDK's own `ApiClient`, exactly as a deployed client would.
 */
export function startApiServer(): Promise<string> {
  origin ??= (async () => {
    await initializeApiDatabase();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => serve(routeApp, request),
    });
    // Proxies retain their per-device login origins, but identities share one
    // stable API domain, just as a deployment with an explicit domain does.
    const routeApp = createRouteApp({
      runtime: {
        ...getDefaultApiServiceRuntime(),
        identityTrustDomain: server.url.origin,
      },
    });
    return server.url.origin;
  })();
  return origin;
}
