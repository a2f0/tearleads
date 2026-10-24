import { expect, test } from "bun:test";
import {
  createMeasuredFetch,
  type RequestMeasurement,
  requestHeader,
  runHeader,
} from "./transport";

function harness(
  transport: typeof fetch,
  signal = new AbortController().signal,
) {
  const requests: RequestMeasurement[] = [];
  return {
    requests,
    fetch: createMeasuredFetch({
      fetch: transport,
      origin: "https://example.test",
      runId: "run",
      sampleId: "run-1",
      startedAt: performance.now(),
      phase: () => "registration",
      signal,
      requests,
    }),
  };
}

test("measure headers without reading the body; retain only timing and correlation metadata", async () => {
  let captured: Request | undefined;
  const response = new Response("secret-response", {
    headers: {
      "server-timing": "total;dur=7000.5, db;dur=6500.1",
      "cf-ray": "ray-IAD",
      "x-tearleads-api-version": "revision",
      "set-cookie": "secret-cookie",
    },
  });
  const h = harness(
    Object.assign(
      async (resource: Parameters<typeof fetch>[0]) => {
        captured = new Request(resource);
        return response;
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const result = await h.fetch(
    "https://example.test/auth/register?secret=query",
    {
      method: "POST",
      body: "secret-body",
      headers: { authorization: "Bearer secret-token" },
    },
  );
  expect(result).toBe(response);
  expect(response.bodyUsed).toBe(false);
  expect(captured?.headers.get(runHeader)).toBe("run");
  expect(captured?.headers.get(requestHeader)).toBe("run-1-1");
  expect(await captured?.text()).toBe("secret-body");
  expect(h.requests[0]).toMatchObject({
    route: "/auth/register",
    status: 200,
    serverMs: 7000.5,
    databaseMs: 6500.1,
    apiVersion: "revision",
    outcome: "response",
  });
  expect(JSON.stringify(h.requests)).not.toContain("secret");
});

test("refuse a different origin and preserve cancellation", async () => {
  let calls = 0;
  const h = harness(
    Object.assign(
      async () => {
        calls++;
        return new Response();
      },
      { preconnect: fetch.preconnect },
    ),
  );
  await expect(h.fetch("https://wrong.test/auth/register")).rejects.toThrow(
    "outside",
  );
  expect(calls).toBe(0);
  const aborted = harness(fetch, AbortSignal.abort());
  await expect(
    aborted.fetch("https://example.test/auth/register"),
  ).rejects.toThrow();
  expect(aborted.requests).toHaveLength(0);
});

test("connection failures are attempts; missing timing stays null", async () => {
  let calls = 0;
  const h = harness(
    Object.assign(
      async () => {
        if (++calls === 1) throw new Error("secret network error");
        return new Response(null, {
          status: 503,
          headers: { "server-timing": "total;dur=NaN, db;dur=-1" },
        });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  await expect(h.fetch("https://example.test/auth/register")).rejects.toThrow();
  await h.fetch("https://example.test/documents/private-id");
  expect(h.requests).toHaveLength(2);
  expect(h.requests[0]).toMatchObject({
    status: null,
    outcome: "transport-error",
  });
  expect(h.requests[1]).toMatchObject({
    route: "other",
    status: 503,
    serverMs: null,
    databaseMs: null,
  });
  expect(JSON.stringify(h.requests)).not.toContain("private-id");
  expect(JSON.stringify(h.requests)).not.toContain("secret");
});

test("request deadline also aborts an unread response body; redirects are refused", async () => {
  let followedRedirect = false;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/redirect")
        return Response.redirect(new URL("/destination", url));
      if (url.pathname === "/destination") {
        followedRedirect = true;
        return new Response("redirect followed");
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
        }),
      );
    },
  });
  const controller = new AbortController();
  try {
    const requests: RequestMeasurement[] = [];
    const measured = createMeasuredFetch({
      fetch,
      origin: server.url.origin,
      runId: "run",
      sampleId: "run-1",
      startedAt: performance.now(),
      phase: () => "registration",
      signal: controller.signal,
      requests,
    });
    await expect(measured(new URL("/redirect", server.url))).rejects.toThrow();
    expect(followedRedirect).toBe(false);
    const response = await measured(server.url);
    controller.abort();
    await expect(response.text()).rejects.toThrow();
    expect(requests[1]?.outcome).toBe("response");
  } finally {
    await server.stop(true);
  }
});
