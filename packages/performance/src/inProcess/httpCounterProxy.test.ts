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

test("holds matching request before upstream while letting concurrent requests proceed and pins origin", async () => {
  const seen: string[] = [];
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      seen.push(`${request.method} ${pathname}`);
      return new Response(pathname, { status: 200 });
    },
  });
  cleanups.push(() => upstream.stop(true));

  const proxy = startHttpCounterProxy(upstream.url.origin);
  cleanups.push(() => proxy.stop());

  // Protocol-relative path must stay pinned to upstream origin rather than
  // escaping to `http://example.invalid`.
  const doubleSlash = await fetch(`${proxy.origin}//example.invalid/ping`);
  expect(doubleSlash.status).toBe(200);
  expect(await doubleSlash.text()).toContain("example.invalid/ping");
  expect(seen.some((entry) => entry.includes("example.invalid/ping"))).toBe(
    true,
  );

  const gate = proxy.holdBeforeRequest(
    ({ method, pathname }) =>
      method === "POST" && pathname === "/documents/d-1/unlink",
  );
  const heldResponse = fetch(`${proxy.origin}/documents/d-1/unlink`, {
    method: "POST",
    body: "rotate",
  });
  await gate.wait();

  // Upstream has not seen the held unlink yet, while an interleaving sync succeeds.
  expect(seen).not.toContain("POST /documents/d-1/unlink");
  const raced = await fetch(`${proxy.origin}/documents/d-1/sync`, {
    method: "POST",
    body: "edit",
  });
  expect(raced.status).toBe(200);
  expect(seen).toContain("POST /documents/d-1/sync");
  expect(seen).not.toContain("POST /documents/d-1/unlink");

  gate.release();
  const completed = await heldResponse;
  expect(completed.status).toBe(200);
  expect(seen.indexOf("POST /documents/d-1/sync")).toBeLessThan(
    seen.indexOf("POST /documents/d-1/unlink"),
  );
});

test("supports cancel, pre-arrival release, and unblocking held requests on proxy.stop", async () => {
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("ok", { status: 200 }),
  });
  cleanups.push(() => upstream.stop(true));

  const proxy = startHttpCounterProxy(upstream.url.origin);
  cleanups.push(() => proxy.stop());

  // Cancelling or releasing before arrival must not pause a subsequent request.
  const cancelled = proxy.holdBeforeRequest(() => true);
  cancelled.cancel();
  const earlyReleased = proxy.holdBeforeRequest(() => true);
  earlyReleased.release();
  expect((await fetch(`${proxy.origin}/ping`)).status).toBe(200);

  // Stopping the proxy while a request is held must unblock it rather than hang.
  const heldGate = proxy.holdBeforeRequest(
    ({ pathname }) => pathname === "/held",
  );
  const inFlight = fetch(`${proxy.origin}/held`).catch(() => null);
  await heldGate.wait();
  await proxy.stop();
  await inFlight;
});
