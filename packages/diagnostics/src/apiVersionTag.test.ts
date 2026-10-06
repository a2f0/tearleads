import { afterEach, expect, spyOn, test } from "bun:test";
import { createBrowserDiagnostics } from "./browser";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

const config: SentryPrivacyConfig = {
  origin: "https://app.tearleads.com",
  scriptPath: "/chunk-test.js",
  environment: "production",
  release: `tearleads-web@${"a".repeat(40)}`,
  dist: "production-app",
};

function boundaryEvent(apiVersion: string | number) {
  return {
    tags: { diagnostic_source: "boundary", api_version: apiVersion },
    exception: { values: [{ type: "Error", value: "private" }] },
  };
}

const previousWindow = globalThis.window;
afterEach(() => {
  globalThis.window = previousWindow;
});

test("client reports keep a well-formed API build and drop anything else", () => {
  const safe = sanitizeSentryEvent(boundaryEvent("2461"), config);
  expect(safe?.tags).toEqual({
    area: "app",
    diagnostic_source: "boundary",
    api_version: "2461",
    privacy: "allowlist-v2",
  });
  expect(sanitizeSentryEvent(safe ?? {}, config)).toEqual(safe);

  for (const forged of ["0", "02461", "2461 ", "v2461", "1".repeat(17), 2461]) {
    expect(
      sanitizeSentryEvent(boundaryEvent(forged), config)?.tags,
    ).not.toHaveProperty("api_version");
  }
});

test("browser diagnostics tag later reports with the API build", async () => {
  const bodies: string[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        bodies.push(String(args[1]?.body));
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    ),
  );
  globalThis.window = Object.assign(Object.create(null), {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  try {
    const diagnostics = createBrowserDiagnostics({
      ...config,
      dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    });
    diagnostics.setApiVersion?.(2461);
    diagnostics.captureError("not an Error", {
      area: "app",
      source: "boundary",
    });
    await diagnostics.dispose();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('"api_version":"2461"');
  } finally {
    fetchSpy.mockRestore();
  }
});
