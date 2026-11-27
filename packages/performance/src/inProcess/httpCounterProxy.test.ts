import { afterEach, expect, test } from "bun:test";
import {
  emptyHttpTraffic,
  httpTrafficSince,
  startHttpCounterProxy,
} from "./httpCounterProxy";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

test("counts requests, 409 conflicts, wire bytes, and route deltas", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith("/conflict")) {
        return Response.json({ code: "stale" }, { status: 409 });
      }
      if (pathname.endsWith("/empty")) {
        return new Response(null, { status: 204 });
      }
      const text = await request.text();
      return new Response(`echo:${text}`, { status: 200 });
    },
  });
  cleanups.push(() => upstream.stop(true));

  const proxy = startHttpCounterProxy(upstream.url.origin);
  cleanups.push(() => proxy.stop());

  const before = proxy.snapshot();
  expect(before).toEqual(emptyHttpTraffic());

  const ok = await fetch(`${proxy.origin}/containers/c-1/revoke`, {
    method: "POST",
    body: "payload",
  });
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("echo:payload");

  const conflict = await fetch(`${proxy.origin}/documents/d-1/conflict`, {
    method: "POST",
    body: "retry",
  });
  expect(conflict.status).toBe(409);

  const empty = await fetch(`${proxy.origin}/documents/d-1/empty`, {
    method: "DELETE",
  });
  expect(empty.status).toBe(204);

  const delta = httpTrafficSince(proxy.snapshot(), before);
  expect(delta.requests).toBe(3);
  expect(delta.conflicts).toBe(1);
  expect(delta.requestBytes).toBe(
    Buffer.byteLength("payload") + Buffer.byteLength("retry"),
  );
  expect(delta.responseBytes).toBeGreaterThan(0);
  expect(delta.byRoute["POST /containers/:containerId/revoke"]?.count).toBe(1);
  expect(delta.byRoute["POST /documents/d-1/conflict"]?.conflicts).toBe(1);
});
