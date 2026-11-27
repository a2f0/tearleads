/**
 * Bun test preload for `perf:scenarios`: attaches opt-in observers to
 * `packages/bob-and-alice`'s in-process API server and harness trace sink,
 * writing sanitized HTTP exchange records to `PERF_SCENARIO_HTTP_OUT` and
 * optional payload audit records to `PERF_PAYLOAD_AUDIT_OUT`.
 */
import { beforeEach } from "bun:test";
import { createCaptureWriter } from "../statements/captureFile";
import {
  createScenarioHttpObserver,
  type ScenarioHttpObservation,
} from "./scenarioHttpObserver";

interface ScenarioHttpEnv {
  readonly [name: string]: string | undefined;
  readonly PERF_SCENARIO_HTTP_OUT?: string;
  readonly PERF_SCENARIO_HTTP_LIMIT?: string;
  readonly PERF_PAYLOAD_AUDIT_OUT?: string;
  readonly PERF_PAYLOAD_AUDIT_STACKS?: string;
}

const defaultLimit = 250_000;
const httpSinkKey = "__tearleadsPerfScenarioHttpSink";
const opSinkKey = "__tearleadsPerfScenarioOpSink";

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

const { out, limit, payloadOut, captureStacks } = readEnv(process.env);
const observer = createScenarioHttpObserver({
  writeHttp: createCaptureWriter(out),
  limit,
  ...(payloadOut ? { writePayload: createCaptureWriter(payloadOut) } : {}),
  captureStacks,
});

function installFetchStackWrapper(): void {
  if (!payloadOut || !captureStacks) return;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 25);
  const original = globalThis.fetch;
  if (Reflect.get(original, "__tearleadsPerfScenarioWrapped") === true) return;
  const wrapped = Object.assign(
    function wrappedScenarioFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const cleanup = isProxyForwardInit(init)
        ? null
        : observer.enqueueStack(
            fetchRequestMethod(input, init),
            fetchRequestUrl(input),
            filteredStack(),
          );
      const pending = original(input, init);
      if (!cleanup) return pending;
      return pending.finally(cleanup);
    },
    original,
    { __tearleadsPerfScenarioWrapped: true },
  );
  globalThis.fetch = wrapped;
}

beforeEach(() => {
  observer.startTest();
  installFetchStackWrapper();
});

installFetchStackWrapper();

Reflect.set(globalThis, httpSinkKey, (obs: ScenarioHttpObservation) => {
  observer.observeHttp(obs);
});

Reflect.set(globalThis, opSinkKey, (message: string) => {
  observer.observeTrace(message);
});
