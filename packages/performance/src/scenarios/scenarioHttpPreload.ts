/**
 * Bun test preload for `perf:scenarios`: attaches opt-in observers to
 * `packages/bob-and-alice`'s in-process API server and harness trace sink,
 * writing sanitized HTTP exchange records to `PERF_SCENARIO_HTTP_OUT` and
 * optional payload audit records to `PERF_PAYLOAD_AUDIT_OUT`.
 */
import { beforeEach } from "bun:test";
import { createPayloadAuditor } from "../canaries/payloadAudit";
import { createCaptureWriter } from "../statements/captureFile";
import type { ScenarioHttpRecord } from "./httpCapture";
import { normalizeScenarioRoute } from "./routeNormalize";

interface ScenarioHttpEnv {
  readonly [name: string]: string | undefined;
  readonly PERF_SCENARIO_HTTP_OUT?: string;
  readonly PERF_SCENARIO_HTTP_LIMIT?: string;
  readonly PERF_PAYLOAD_AUDIT_OUT?: string;
  readonly PERF_PAYLOAD_AUDIT_STACKS?: string;
}

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

const defaultLimit = 250_000;
const httpSinkKey = "__tearleadsPerfScenarioHttpSink";
const opSinkKey = "__tearleadsPerfScenarioOpSink";
const worldOperationPattern = /^[a-z][A-Za-z]+$/u;

function readEnv(env: ScenarioHttpEnv) {
  const out = env.PERF_SCENARIO_HTTP_OUT;
  if (!out) {
    throw new Error("PERF_SCENARIO_HTTP_OUT must name the capture file.");
  }
  const rawLimit = env.PERF_SCENARIO_HTTP_LIMIT;
  if (rawLimit !== undefined && !/^[1-9]\d*$/u.test(rawLimit)) {
    throw new Error("PERF_SCENARIO_HTTP_LIMIT must be a positive integer.");
  }
  return {
    out,
    limit: rawLimit === undefined ? defaultLimit : Number(rawLimit),
    payloadOut: env.PERF_PAYLOAD_AUDIT_OUT ?? null,
    captureStacks: env.PERF_PAYLOAD_AUDIT_STACKS === "1",
  };
}

function parseErrorCode(status: number, body: string): string | undefined {
  if (status < 400 || !body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const code: unknown = Reflect.get(parsed, "code");
    return typeof code === "string" && code.length > 0 ? code : undefined;
  } catch {
    return undefined;
  }
}

function pathKey(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    return `${method.toUpperCase()} ${parsed.pathname}${parsed.search}`;
  } catch {
    return `${method.toUpperCase()} ${url}`;
  }
}

function filteredStack(): string {
  const raw = new Error().stack ?? "";
  return raw
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("/packages/") &&
        !line.includes("scenarioHttpPreload") &&
        !line.includes("bob-and-alice/src/harness/transport") &&
        !line.includes("node_modules"),
    )
    .slice(0, 4)
    .join(" <- ");
}

const { out, limit, payloadOut, captureStacks } = readEnv(process.env);
const write = createCaptureWriter(out);
const auditor = payloadOut
  ? createPayloadAuditor({ write: createCaptureWriter(payloadOut) })
  : null;

const stackQueues = new Map<string, string[]>();
let written = 0;
let testNumber = 0;
let payloadRequestIndex = 0;

function record(entry: ScenarioHttpRecord): void {
  if (written > limit) return;
  written += 1;
  write(`${JSON.stringify(written > limit ? { truncated: limit } : entry)}\n`);
}

function fetchRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.toString() : input.url;
}

function fetchRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method) return init.method;
  return typeof input === "object" && "method" in input ? input.method : "GET";
}

function isProxyForwardInit(init?: RequestInit): boolean {
  return (
    typeof init === "object" &&
    init !== null &&
    Reflect.get(init, "decompress") === false
  );
}

function recordFetchStack(input: RequestInfo | URL, init?: RequestInit): void {
  if (isProxyForwardInit(init)) return;
  const key = pathKey(fetchRequestMethod(input, init), fetchRequestUrl(input));
  const queue = stackQueues.get(key) ?? [];
  queue.push(filteredStack());
  stackQueues.set(key, queue);
}

function installFetchStackWrapper(): void {
  if (!auditor || !captureStacks) return;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 25);
  const original = globalThis.fetch;
  if (Reflect.get(original, "__tearleadsPerfScenarioWrapped") === true) return;
  const wrapped = Object.assign(
    function wrappedScenarioFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      recordFetchStack(input, init);
      return original(input, init);
    },
    original,
    { __tearleadsPerfScenarioWrapped: true },
  );
  globalThis.fetch = wrapped;
}

function takeStack(method: string, url: string): string | undefined {
  if (!captureStacks) return undefined;
  return stackQueues.get(pathKey(method, url))?.shift();
}

beforeEach(() => {
  testNumber += 1;
  payloadRequestIndex = 0;
  auditor?.resetTest();
  stackQueues.clear();
  installFetchStackWrapper();
});

installFetchStackWrapper();

Reflect.set(globalThis, httpSinkKey, (obs: ScenarioHttpObservation) => {
  const route = normalizeScenarioRoute(obs.method, obs.url);
  const errorCode = parseErrorCode(obs.status, obs.responseBody);
  record({
    kind: "http",
    route,
    method: obs.method.toUpperCase(),
    status: obs.status,
    ...(errorCode !== undefined ? { errorCode } : {}),
    requestBytes: obs.requestBodyBytes,
    responseBytes: obs.responseBodyBytes,
    durationMs: Math.round(obs.durationMs * 10) / 10,
    knownManifestsCount: obs.knownManifestsCount,
  });
  if (auditor) {
    const index = payloadRequestIndex;
    payloadRequestIndex += 1;
    auditor.recordPhase({
      label: `test-${testNumber}`,
      startIndex: index,
      requests: [{ ...obs, routeKey: route }],
      takeStack,
    });
  }
});

Reflect.set(globalThis, opSinkKey, (message: string) => {
  if (worldOperationPattern.test(message)) {
    record({ kind: "op", name: message });
  }
});
