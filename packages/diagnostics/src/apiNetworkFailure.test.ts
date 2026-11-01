import { expect, spyOn, test } from "bun:test";
import type { Event } from "@sentry/core";
import {
  type ApiNetworkFailureInput,
  apiNetworkFailureTags,
  createApiNetworkFailureReporter,
} from "./apiNetworkFailure";
import { createBrowserDiagnostics } from "./browser";
import { type SentryPrivacyConfig, sanitizeSentryEvent } from "./privacy";

const routes: ReadonlySet<string> = new Set(
  // Stand-in for the app's operation registry (apiRouteTemplates).
  [
    "/",
    "/auth/sessions",
    "/containers/{containerId}/share",
    ...Array.from({ length: 50 }, (_, index) => `/fixture/route-${index}`),
  ],
);
const secret = "SYNTHETIC_SECRET_TOKEN";
const id = "3f2a9c1e-7b44-4d1a-9e0f-5a6b7c8d9e0f";
const concreteUrl = `https://api.tearleads.com/containers/${id}/share?token=${secret}`;
const unroutedConfig: SentryPrivacyConfig = {
  origin: "https://app.tearleads.com",
  scriptPath: "/chunk-abc123.js",
  environment: "production",
  release: `tearleads-web@${"a".repeat(40)}`,
  dist: "production-app",
};
const config: SentryPrivacyConfig = {
  ...unroutedConfig,
  routeTemplates: routes,
};

function failure(
  overrides: Partial<ApiNetworkFailureInput> = {},
): ApiNetworkFailureInput & Record<string, unknown> {
  return {
    classification: "api-unreachable",
    hint: `open https://self-hosted.example/${secret} in a tab`,
    method: "POST",
    pathTemplate: "/containers/{containerId}/share",
    apiOrigin: "https://api.tearleads.com",
    pageOrigin: config.origin,
    crossOrigin: true,
    preflight: true,
    attempt: 2,
    elapsedMs: 1_234,
    online: true,
    errorName: "TypeError",
    errorMessage: "Failed to fetch",
    causeName: null,
    causeMessage: `https://api.tearleads.com/containers/${id}?token=${secret}`,
    probe: "unreachable",
    // Never part of the details, but a careless caller could pass them.
    headers: { Authorization: `Bearer ${secret}` },
    body: `{"documentId":"${id}","text":"${secret}"}`,
    userId: id,
    url: concreteUrl,
    ...overrides,
  };
}

function reviewedEvent(input: ApiNetworkFailureInput): Event {
  const tags = apiNetworkFailureTags(input, config.origin, routes);
  if (!tags) throw new Error("expected a reportable failure");
  return {
    event_id: "b".repeat(32),
    level: "warning",
    tags: { area: "app", diagnostic_source: "api-network", ...tags },
    exception: { values: [{ type: "ApiNetworkError", value: secret }] },
    request: { url: concreteUrl, headers: { secret } },
    extra: { failure: input },
    user: { id },
    breadcrumbs: [
      {
        category: "api.network",
        data: {
          api_network_class: "offline",
          api_network_method: "GET",
          api_network_route: "/auth/sessions",
          api_network_attempt: "1",
          api_network_elapsed: "lt-100ms",
          api_network_online: "offline",
          secret,
        },
        timestamp: 10,
      },
      {
        category: "api.network",
        data: {
          api_network_class: "offline",
          api_network_method: "GET",
          api_network_route: `/containers/${id}`,
          api_network_attempt: "1",
          api_network_elapsed: "lt-100ms",
          api_network_online: "offline",
        },
      },
    ],
  };
}

test("a network failure event carries exactly the reviewed coarse fields", () => {
  const event = sanitizeSentryEvent(reviewedEvent(failure()), config);
  expect(event).toEqual({
    type: undefined,
    event_id: "b".repeat(32),
    timestamp: expect.any(Number),
    platform: "javascript",
    level: "warning",
    environment: "production",
    release: config.release,
    dist: "production-app",
    user: { ip_address: "0.0.0.0" },
    tags: {
      area: "app",
      diagnostic_source: "api-network",
      api_network_class: "api-unreachable",
      api_network_method: "POST",
      api_network_route: "/containers/{containerId}/share",
      api_network_attempt: "2",
      api_network_elapsed: "lt-3s",
      api_network_online: "online",
      api_network_cross_origin: "true",
      api_network_preflight: "true",
      api_network_api_origin: "default",
      api_network_page_origin: "default",
      api_network_probe: "unreachable",
      api_network_error: "TypeError",
      api_network_cause: "none",
      api_network_message: "failed-to-fetch",
      privacy: "network-allowlist-v1",
    },
    exception: {
      values: [
        {
          type: "ApiNetworkError",
          value: "API request failed without a response (api-unreachable)",
          mechanism: { type: "generic", handled: true },
        },
      ],
    },
    breadcrumbs: [
      {
        category: "api.network",
        level: "warning",
        data: {
          api_network_class: "offline",
          api_network_method: "GET",
          api_network_route: "/auth/sessions",
          api_network_attempt: "1",
          api_network_elapsed: "lt-100ms",
          api_network_online: "offline",
        },
        timestamp: 10,
      },
    ],
  });
  const sent = JSON.stringify(event);
  expect(sent).not.toContain(secret);
  expect(sent).not.toContain(id);
  expect(sent).not.toContain("self-hosted");
});

test("concrete paths, custom origins, and unknown runtime text are coarsened", () => {
  const tags = apiNetworkFailureTags(
    failure({
      method: "propfind",
      pathTemplate: `/containers/${id}/share?token=${secret}`,
      apiOrigin: "https://self-hosted.example:8443",
      pageOrigin: "https://intranet.example",
      crossOrigin: null,
      attempt: 7,
      elapsedMs: 45_000,
      online: null,
      errorName: `Custom${secret}`,
      errorMessage: `Failed to fetch https://self-hosted.example/${secret}`,
      causeName: "TypeError",
      probe: "not-run",
    }),
    config.origin,
    routes,
  );
  expect(tags).toMatchObject({
    api_network_method: "other",
    api_network_route: "other",
    api_network_api_origin: "custom",
    api_network_page_origin: "custom",
    api_network_cross_origin: "unknown",
    api_network_attempt: "other",
    api_network_elapsed: "gte-30s",
    api_network_online: "unknown",
    api_network_error: "other",
    api_network_cause: "TypeError",
    api_network_message: "failed-to-fetch",
    api_network_probe: "not-run",
  });
  for (const route of [
    "/containers/private-document",
    "/containers/123",
    "/documents/abcDEF",
    "/blobs/%7Bid%7D",
    "/a//b",
    "containers",
  ]) {
    expect(
      apiNetworkFailureTags(
        failure({ pathTemplate: route }),
        config.origin,
        routes,
      )?.api_network_route,
    ).toBe("other");
  }
  expect(
    apiNetworkFailureTags(
      failure({ errorMessage: `Something ${secret}` }),
      config.origin,
      routes,
    )?.api_network_message,
  ).toBe("other");
  expect(JSON.stringify(tags)).not.toContain(secret);
});

test("cancellations and unknown classes are never reported", () => {
  expect(
    apiNetworkFailureTags(
      failure({ classification: "aborted" }),
      config.origin,
      routes,
    ),
  ).toBeNull();
  expect(
    apiNetworkFailureTags(
      failure({ classification: secret }),
      config.origin,
      routes,
    ),
  ).toBeNull();
});

test("the event boundary drops a network event whose tags leave the vocabulary", () => {
  for (const [name, value] of [
    ["api_network_route", `/containers/${id}`],
    ["api_network_route", "/containers/private-document"],
    ["api_network_api_origin", "https://self-hosted.example"],
    ["api_network_message", secret],
    ["api_network_class", "aborted"],
    ["api_network_elapsed", "1234"],
  ] as const) {
    const event = reviewedEvent(failure());
    event.tags = { ...event.tags, [name]: value };
    expect(sanitizeSentryEvent(event, config)).toBeNull();
  }
  const missing = reviewedEvent(failure());
  missing.tags = Object.fromEntries(
    Object.entries(missing.tags ?? {}).filter(
      ([name]) => name !== "api_network_probe",
    ),
  );
  expect(sanitizeSentryEvent(missing, config)).toBeNull();
});

test("server runtimes never admit network events", () => {
  expect(
    sanitizeSentryEvent(reviewedEvent(failure()), {
      ...config,
      dist: "production",
      runtime: "api",
      serverSourceRoot: "/srv",
    }),
  ).toBeNull();
});

test("one event per class per page load, then deduplicated breadcrumbs", () => {
  let now = 0;
  const events: string[] = [];
  const breadcrumbs: Record<string, string>[] = [];
  const report = createApiNetworkFailureReporter(
    {
      captureEvent: (tags) => events.push(tags.api_network_class),
      addBreadcrumb: (data) => breadcrumbs.push(data),
    },
    config.origin,
    () => routes,
    () => now,
  );

  for (let index = 0; index < 50; index++) report(failure());
  report(failure({ classification: "offline" }));
  report(failure({ classification: "aborted" }));
  expect(events).toEqual(["api-unreachable", "offline"]);
  // 49 repeats of one class, method, and route within a minute: one crumb.
  expect(breadcrumbs).toHaveLength(1);
  expect(Object.keys(breadcrumbs[0] ?? {})).toEqual([
    "api_network_class",
    "api_network_method",
    "api_network_route",
    "api_network_attempt",
    "api_network_elapsed",
    "api_network_online",
  ]);

  report(failure({ pathTemplate: "/auth/sessions", method: "GET" }));
  expect(breadcrumbs).toHaveLength(2);
  now = 59_999;
  report(failure());
  expect(breadcrumbs).toHaveLength(2);
  now = 60_000;
  report(failure());
  expect(breadcrumbs).toHaveLength(3);
  now = 10 * 60 * 60_000;
  report(failure());
  expect(events).toEqual(["api-unreachable", "offline"]);
});

test("the browser client sends reviewed network events and breadcrumbs only", async () => {
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
  const hadWindow = Object.hasOwn(globalThis, "window");
  const previousWindow = globalThis.window;
  globalThis.window = Object.assign(Object.create(null), {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  try {
    const diagnostics = createBrowserDiagnostics({
      ...unroutedConfig,
      dsn: `https://${"c".repeat(32)}@o1.ingest.us.sentry.io/1`,
    });
    diagnostics.setApiRouteTemplates?.(routes);
    for (let index = 0; index < 20; index++)
      diagnostics.reportApiNetworkFailure?.(failure());
    diagnostics.reportApiNetworkFailure?.(
      failure({ classification: "offline" }),
    );
    const many = [...routes].slice(3, 40);
    for (const route of many)
      diagnostics.reportApiNetworkFailure?.(failure({ pathTemplate: route }));
    // Logged failures' `error` crumbs do not start a new run; user activity does.
    diagnostics.addBreadcrumb({ area: "app", action: "error" });
    for (const route of many)
      diagnostics.reportApiNetworkFailure?.(
        failure({ pathTemplate: route, method: "PUT" }),
      );
    diagnostics.addBreadcrumb({ area: "explorer", action: "open" });
    for (const route of many)
      diagnostics.reportApiNetworkFailure?.(
        failure({ pathTemplate: route, method: "GET" }),
      );
    diagnostics.captureError("not an Error", {
      area: "app",
      source: "boundary",
    });
    await diagnostics.dispose();

    const events = bodies.map((body) =>
      JSON.parse(body.split("\n")[2] ?? "{}"),
    );
    expect(events.map((event) => event.exception.values[0].type)).toEqual([
      "ApiNetworkError",
      "ApiNetworkError",
      "Error",
    ]);
    expect(events[0].tags.api_network_class).toBe("api-unreachable");
    expect(events[0].tags.api_network_route).toBe(
      "/containers/{containerId}/share",
    );
    expect(events[1].tags.api_network_class).toBe("offline");
    // Repeats became breadcrumbs, not events: ten network crumbs at most
    // before the activity crumb, and ten more after it.
    expect(
      events[2].breadcrumbs.map(
        (crumb: { category: string }) => crumb.category,
      ),
    ).toEqual([
      ...Array<string>(10).fill("api.network"),
      "app.activity",
      "app.activity",
      ...Array<string>(10).fill("api.network"),
    ]);
    expect(
      events[2].breadcrumbs
        .filter(
          (crumb: { category: string }) => crumb.category === "app.activity",
        )
        .map((crumb: { data: { action: string } }) => crumb.data.action),
    ).toEqual(["error", "open"]);
    const sent = bodies.join("\n");
    expect(sent).not.toContain(secret);
    expect(sent).not.toContain(id);
    expect(sent).not.toContain("self-hosted");
  } finally {
    fetchSpy.mockRestore();
    if (hadWindow) globalThis.window = previousWindow;
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("registered templates are sent as themselves, nothing without the registry", () => {
  const coarsened = [...routes].filter(
    (route) =>
      apiNetworkFailureTags(
        failure({ pathTemplate: route }),
        config.origin,
        routes,
      )?.api_network_route !== route,
  );

  expect(coarsened).toEqual([]);
  expect(
    apiNetworkFailureTags(failure(), config.origin, undefined)
      ?.api_network_route,
  ).toBe("other");
  const event = reviewedEvent(failure());
  expect(sanitizeSentryEvent(event, unroutedConfig)).toBeNull();
});

test("without user activity, bursts across routes and minutes keep at most ten network breadcrumbs", () => {
  let now = 0;
  const breadcrumbs: Record<string, string>[] = [];
  const report = createApiNetworkFailureReporter(
    { captureEvent: () => {}, addBreadcrumb: (data) => breadcrumbs.push(data) },
    config.origin,
    () => routes,
    () => now,
  );
  const templates = [...routes];
  for (let minute = 0; minute < 5; minute++) {
    now = minute * 60_000;
    for (const route of templates) report(failure({ pathTemplate: route }));
  }
  expect(breadcrumbs).toHaveLength(10);
  report.noteActivity();
  for (const route of templates.slice(30, 50))
    report(failure({ pathTemplate: route }));
  expect(breadcrumbs).toHaveLength(20);
});
