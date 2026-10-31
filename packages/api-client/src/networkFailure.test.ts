import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { registerOperation } from "@tearleads/validators/operation";
import type { ApiReachabilityProbe } from "./apiReachabilityProbe";
import { ApiRequestMetrics } from "./apiRequestMetrics";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import {
  ApiNetworkError,
  needsCorsPreflight,
  redactUrls,
} from "./networkFailure";
import type { RequestFailure } from "./types";

const apiBaseUrl = "https://api.example.test";
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function setOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: online },
  });
}

function failFetch(error: unknown): void {
  globalThis.fetch = Object.assign(
    mock(async () => {
      throw error;
    }),
    { preconnect: () => undefined },
  );
}

async function register(
  probe: ApiReachabilityProbe | null,
  options: { signal?: AbortSignal; body?: string } = {},
): Promise<{ failure: RequestFailure; errors: string[] }> {
  const runtime = new ApiRequestRuntime(apiBaseUrl, {
    getIdentity: () => null,
    metrics: new ApiRequestMetrics(),
    networkFailureProbe: probe,
  });
  const errors: string[] = [];
  runtime.setOnError((message) => errors.push(message));
  runtime.setAuthToken("secret-session-token");
  const result = await runtime.responseRequest(
    "/auth/register",
    "POST",
    options.body ?? JSON.stringify({ password: "secret-body-value" }),
    options.signal ? { signal: options.signal } : undefined,
    [],
    registerOperation,
  );
  if (result.ok) throw new Error("expected a failure");
  return { failure: result, errors };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://app.example.test/workspace"),
  });
  setOnline(true);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of [
    ["location", originalLocation],
    ["navigator", originalNavigator],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("a thrown fetch carries what the browser could observe", async () => {
  failFetch(new TypeError("Failed to fetch"));
  const { failure, errors } = await register(null);

  expect(failure.kind).toBe("network");
  expect(failure.message).toBe("POST /auth/register: Failed to fetch");
  expect(errors).toEqual([failure.message]);
  expect(failure.networkError).toBeInstanceOf(ApiNetworkError);
  expect(failure.networkError?.details).toMatchObject({
    apiOrigin: "https://api.example.test",
    attempt: 1,
    classification: "unclassified",
    crossOrigin: true,
    errorMessage: "Failed to fetch",
    errorName: "TypeError",
    method: "POST",
    online: true,
    pageOrigin: "https://app.example.test",
    pathTemplate: "/auth/register",
    preflight: true,
    probe: "not-run",
  });
  expect(failure.networkError?.details.elapsedMs).toBeGreaterThanOrEqual(0);
});

test("an unreachable probe classifies the failure and logs a hint", async () => {
  failFetch(new TypeError("Failed to fetch"));
  const probe = mock(async () => "unreachable" as const);
  const { failure, errors } = await register(probe);

  expect(probe).toHaveBeenCalledWith("https://api.example.test");
  expect(failure.networkError?.details).toMatchObject({
    classification: "api-unreachable",
    probe: "unreachable",
  });
  expect(errors).toEqual([
    "POST /auth/register: Failed to fetch (api-unreachable: API host unreachable from this browser: check DNS, extensions/shields, or network; open https://api.example.test/ in a tab)",
  ]);
});

test("a probe that throws counts as unreachable", async () => {
  failFetch(new TypeError("Load failed"));
  const { failure } = await register(async () => {
    throw new Error("probe crashed");
  });
  expect(failure.networkError?.details.classification).toBe("api-unreachable");
});

test("a reachable host points at CORS, a blocking rule, or a dropped call", async () => {
  failFetch(new TypeError("NetworkError when attempting to fetch resource."));
  const { failure } = await register(async () => "reachable");
  expect(failure.networkError?.details).toMatchObject({
    classification: "cors-or-blocked",
    probe: "reachable",
  });
  expect(failure.message).toContain("a CORS/preflight rejection");
});

test("an offline device skips the probe", async () => {
  setOnline(false);
  failFetch(new TypeError("Failed to fetch"));
  const probe = mock(async () => "reachable" as const);
  const { failure } = await register(probe);
  expect(probe).not.toHaveBeenCalled();
  expect(failure.networkError?.details).toMatchObject({
    classification: "offline",
    online: false,
    probe: "not-run",
  });
  expect(failure.message).toContain("(offline: this device reports no network");
});

test("caller timeouts and aborts stay cancellations and skip the probe", async () => {
  const probe = mock(async () => "reachable" as const);
  for (const [reason, classification] of [
    [new DOMException("timed out", "TimeoutError"), "timeout"],
    [new DOMException("aborted", "AbortError"), "aborted"],
  ] as const) {
    const controller = new AbortController();
    controller.abort(reason);
    failFetch(reason);
    const { failure, errors } = await register(probe, {
      signal: controller.signal,
    });
    expect(failure.kind).toBe("cancelled");
    expect(errors).toEqual([]);
    expect(failure.networkError?.details.classification).toBe(classification);
  }
  expect(probe).not.toHaveBeenCalled();
});

test("a runtime TimeoutError without a caller signal classifies as timeout", async () => {
  failFetch(new DOMException("The operation timed out.", "TimeoutError"));
  const { failure } = await register(async () => "reachable");
  expect(failure.kind).toBe("network");
  expect(failure.networkError?.details.classification).toBe("timeout");
});

test("no header, token, body, or query value reaches the error", async () => {
  const cause = new Error(
    "connect to https://api.example.test/auth/register?token=secret-query-value failed",
  );
  failFetch(
    new TypeError(
      "fetch failed for https://api.example.test/auth/register?token=secret-query-value#secret-fragment",
      { cause },
    ),
  );
  const { failure } = await register(async () => "unreachable");
  const error = failure.networkError;
  const serialized = JSON.stringify({
    details: error?.details,
    message: error?.message,
    name: error?.name,
  });
  for (const secret of [
    "secret-session-token",
    "secret-body-value",
    "secret-query-value",
    "secret-fragment",
    "Authorization",
    "Bearer",
  ]) {
    expect({ secret, leaked: serialized.includes(secret) }).toEqual({
      secret,
      leaked: false,
    });
  }
  expect(error?.details.errorMessage).toBe(
    "fetch failed for https://api.example.test/auth/register",
  );
  expect(error?.details.causeMessage).toBe(
    "connect to https://api.example.test/auth/register failed",
  );
});

test("CORS preflight follows the Fetch spec's simple-request rules", () => {
  expect(needsCorsPreflight("GET", {})).toBe(false);
  expect(needsCorsPreflight("POST", { "Content-Type": "text/plain" })).toBe(
    false,
  );
  expect(
    needsCorsPreflight("POST", { "content-type": "application/json" }),
  ).toBe(true);
  expect(needsCorsPreflight("GET", { Authorization: "Bearer x" })).toBe(true);
  expect(needsCorsPreflight("DELETE", {})).toBe(true);
});

test("URL redaction keeps origin and path and bounds the length", () => {
  expect(redactUrls("see wss://h.test/events?ticket=t1 now")).toBe(
    "see wss://h.test/events now",
  );
  expect(redactUrls("x".repeat(300))).toHaveLength(203);
});
