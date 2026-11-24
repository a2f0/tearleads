import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { ApiNetworkFailureInput } from "./activity";
import { createBrowserDiagnostics } from "./browser";
import type { SentryConfig } from "./config";

const config: SentryConfig = {
  dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  origin: "https://app.tearleads.com",
  scriptPath: "/chunk-test.js",
  environment: "production",
  release: `tearleads-web@${"a".repeat(40)}`,
  dist: "production-app",
};

const networkFailure: ApiNetworkFailureInput = {
  classification: "api-unreachable",
  method: "POST",
  pathTemplate: "/containers",
  apiOrigin: "https://api.tearleads.com",
  pageOrigin: config.origin,
  crossOrigin: true,
  preflight: true,
  attempt: 1,
  elapsedMs: 900,
  online: true,
  errorName: "TypeError",
  errorMessage: "Failed to fetch",
  causeName: null,
  probe: "unreachable",
};

function switchableConsent(initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    enabled: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: boolean) {
      value = next;
      for (const listener of listeners) listener();
    },
    listeners: () => listeners.size,
  };
}

// An unhandled error whose only frame is the admitted bundle, so it reports.
function applicationError(): Error {
  const error = new TypeError("SYNTHETIC_PRIVATE_VALUE");
  error.stack = `TypeError: SYNTHETIC_PRIVATE_VALUE\n    at run (${config.origin}${config.scriptPath}:10:20)`;
  return error;
}

const boundary = { area: "app", source: "boundary" } as const;
const bodies: string[] = [];
const handlers = new Map<string, (event: unknown) => void>();
const previousWindow = globalThis.window;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  bodies.length = 0;
  handlers.clear();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        bodies.push(String(args[1]?.body));
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
  globalThis.window = Object.assign(Object.create(null), {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    removeEventListener: (type: string) => handlers.delete(type),
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
  globalThis.window = previousWindow;
});

test("nothing is recorded or sent before the user opts in", async () => {
  const consent = switchableConsent(false);
  const diagnostics = createBrowserDiagnostics(config, consent);
  diagnostics.addBreadcrumb({ area: "explorer", action: "move-to-trash" });
  diagnostics.captureError("not an Error", boundary);
  handlers.get("error")?.({ error: applicationError() });
  diagnostics.reportApiNetworkFailure?.(networkFailure);
  await diagnostics.flush();
  expect(bodies).toEqual([]);

  consent.set(true);
  handlers.get("error")?.({ error: applicationError() });
  diagnostics.reportApiNetworkFailure?.(networkFailure);
  await diagnostics.dispose();

  expect(bodies).toHaveLength(2);
  expect(bodies.join()).not.toContain("move-to-trash");
  expect(bodies[1]).toContain("api-unreachable");
});

test("withdrawing consent forgets the trail gathered with it", async () => {
  const consent = switchableConsent(true);
  const diagnostics = createBrowserDiagnostics(config, consent);
  diagnostics.addBreadcrumb({ area: "explorer", action: "root-view" });
  consent.set(false);
  diagnostics.captureError("not an Error", boundary);
  await diagnostics.flush();
  expect(bodies).toEqual([]);

  consent.set(true);
  diagnostics.addBreadcrumb({ area: "notes", action: "open" });
  diagnostics.captureError("not an Error", boundary);
  await diagnostics.dispose();

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('"area":"notes"');
  expect(bodies[0]).not.toContain("root-view");
  expect(consent.listeners()).toBe(0);
});
