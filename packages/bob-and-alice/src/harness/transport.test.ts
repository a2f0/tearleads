import { expect, test } from "bun:test";
import { DeviceTransport } from "./transport";

test("the device proxy preserves the client authentication origin", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) =>
      Response.json({
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      }),
  });
  const transport = new DeviceTransport(upstream.url.origin);
  try {
    const response = await fetch(`${transport.origin}/auth/register?probe=1`, {
      method: "POST",
      headers: { authorization: "test-authorization" },
      body: "registration-body",
    });
    expect(await response.json()).toEqual({
      url: `${transport.origin}/auth/register?probe=1`,
      authorization: "test-authorization",
      body: "registration-body",
    });
  } finally {
    transport.dispose();
    await upstream.stop(true);
  }
});

test.each(["", "{malformed"])(
  "the device proxy forwards an invalid JSON body unchanged (%j)",
  async (body) => {
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) =>
        new Response(await request.text(), { status: 422 }),
    });
    const transport = new DeviceTransport(upstream.url.origin);
    try {
      const response = await fetch(transport.origin, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(response.status).toBe(422);
      expect(await response.text()).toBe(body);
      expect(transport.history).toEqual([
        { method: "POST", path: "/", body: null, status: 422 },
      ]);
    } finally {
      transport.dispose();
      await upstream.stop(true);
    }
  },
);

test("the device proxy preserves compressed HTTP response bytes", async () => {
  const text = "A sufficiently long attribution response. ".repeat(100);
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(Bun.gzipSync(text), {
        headers: { "content-encoding": "gzip", "content-type": "text/plain" },
      }),
  });
  const transport = new DeviceTransport(upstream.url.origin);
  try {
    const response = await fetch(transport.origin);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toBe(text);
  } finally {
    transport.dispose();
    await upstream.stop(true);
  }
});

test("the device proxy rewrites a matching JSON request and records the one sent", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) =>
      Response.json({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      }),
  });
  const transport = new DeviceTransport(upstream.url.origin);
  transport.rewriteRequests(
    (request) => request.path === "/sync",
    (body) => ({ ...Object(body), maxPageUpdates: 1 }),
  );
  const send = async (path: string): Promise<unknown> => {
    const response = await fetch(transport.origin + path, {
      method: "POST",
      headers: {
        authorization: "test-authorization",
        "content-type": "application/json",
      },
      body: JSON.stringify({ outgoingUpdates: [] }),
    });
    return response.json();
  };
  try {
    expect(await send("/sync")).toEqual({
      authorization: "test-authorization",
      body: { maxPageUpdates: 1, outgoingUpdates: [] },
    });
    expect(await send("/other")).toEqual({
      authorization: "test-authorization",
      body: { outgoingUpdates: [] },
    });
    expect(transport.history.map(({ body }) => body)).toEqual([
      { outgoingUpdates: [] },
      { outgoingUpdates: [] },
    ]);
  } finally {
    transport.dispose();
    await upstream.stop(true);
  }
});

// A rewritten request is built anew from the SDK's. It must still end when
// its sender gives up, as an unrewritten one does: a held sync that the
// device cancelled would otherwise go on to commit upstream.
test("a rewritten request is cancelled with its sender", async () => {
  const reached = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      request.signal.addEventListener("abort", () => cancelled.resolve());
      reached.resolve();
      return new Promise<Response>(() => {});
    },
  });
  const transport = new DeviceTransport(upstream.url.origin);
  transport.rewriteRequests(
    () => true,
    (body) => ({ ...Object(body), maxPageUpdates: 1 }),
  );
  const sender = new AbortController();
  try {
    const sent = fetch(`${transport.origin}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outgoingUpdates: [] }),
      signal: sender.signal,
    }).then(
      () => "answered",
      () => "cancelled",
    );
    await reached.promise;
    sender.abort();
    expect(await sent).toBe("cancelled");
    const outcome = await Promise.race([
      cancelled.promise.then(() => "upstream cancelled"),
      Bun.sleep(2_000).then(() => "upstream still running"),
    ]);
    expect(outcome).toBe("upstream cancelled");
  } finally {
    transport.dispose();
    await upstream.stop(true);
  }
});
