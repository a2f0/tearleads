import { expect, test } from "bun:test";
import { openCloudflareTail } from "./cloudflare";

class TestSocket extends EventTarget {
  binaryType = "arraybuffer";
  closed = false;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function harness() {
  const socket = new TestSocket();
  const requests: Request[] = [];
  const initOptions: (RequestInit | undefined)[] = [];
  const runtime: NonNullable<Parameters<typeof openCloudflareTail>[2]> = {
    account: "a".repeat(32),
    token: "secret-token",
    openTimeoutMs: 20,
    fetch: Object.assign(
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(new Request(url, init));
        initOptions.push(init);
        return Response.json({
          result: { id: "tail-id", url: "wss://tail.example.test" },
        });
      },
      { preconnect: fetch.preconnect },
    ),
    connect: () => {
      queueMicrotask(() => socket.dispatchEvent(new Event("open")));
      return socket as unknown as WebSocket;
    },
  };
  return { runtime, socket, requests, initOptions };
}

test("credentials and header filter reach only the tail API; close deletes its exact session", async () => {
  const h = harness();
  const tail = await openCloudflareTail("worker", "run", h.runtime);
  expect(h.requests[0]?.headers.get("authorization")).toBe(
    "Bearer secret-token",
  );
  expect(await h.requests[0]?.json()).toEqual({
    filters: [{ header: { key: "x-tearleads-perf-run", query: "run" } }],
  });
  expect(h.initOptions[0]?.redirect).toBe("error");
  expect(h.socket.sent).toEqual(['{"debug":false}']);
  await tail.close();
  expect(h.socket.closed).toBe(true);
  expect(h.requests[1]?.method).toBe("DELETE");
  expect(h.requests[1]?.url).toEndWith("/workers/scripts/worker/tails/tail-id");
  expect(JSON.stringify(tail)).not.toContain("secret-token");
});

test("missing credentials never make an API request", async () => {
  const h = harness();
  h.runtime.token = undefined;
  await expect(openCloudflareTail("worker", "run", h.runtime)).rejects.toThrow(
    "needs",
  );
  expect(h.requests).toHaveLength(0);
});

test("invalid response shapes fail; a known tail is deleted even if its socket URL is bad", async () => {
  const h = harness();
  const transport = h.runtime.fetch;
  h.runtime.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      await transport(url, init);
      return Response.json({
        result: { id: "tail-id", url: "http://bad.test" },
      });
    },
    { preconnect: fetch.preconnect },
  );
  await expect(openCloudflareTail("worker", "run", h.runtime)).rejects.toThrow(
    "Invalid",
  );
  expect(h.requests.map((request) => request.method)).toEqual([
    "POST",
    "DELETE",
  ]);
});

test("socket startup timeout closes and deletes the session", async () => {
  const h = harness();
  h.runtime.connect = () => h.socket as unknown as WebSocket;
  await expect(openCloudflareTail("worker", "run", h.runtime)).rejects.toThrow(
    "timed out",
  );
  expect(h.socket.closed).toBe(true);
  expect(h.requests.at(-1)?.method).toBe("DELETE");
});

test("event limits and failed deletion produce warnings without retaining raw messages", async () => {
  const h = harness();
  const tail = await openCloudflareTail("worker", "run", h.runtime);
  const event = JSON.stringify({
    event: {
      request: {
        headers: {
          "x-tearleads-perf-run": "run",
          "x-tearleads-perf-request": "run-1-1",
        },
      },
    },
    logs: [{ message: ["secret-content"] }],
  });
  for (let i = 0; i < 501; i++) h.socket.message(event);
  h.socket.message("invalid-json-secret");
  h.runtime.fetch = Object.assign(
    async () => new Response(null, { status: 403 }),
    { preconnect: fetch.preconnect },
  );
  // The API captures its transport at startup; inject the failing deletion
  // in a second session instead of mutating a live session's dependencies.
  expect(tail.events).toHaveLength(500);
  expect(tail.warnings).toContain(
    "Tail event limit reached; later events omitted.",
  );
  expect(JSON.stringify(tail)).not.toContain("secret-content");
  expect(JSON.stringify(tail)).not.toContain("invalid-json-secret");
  await tail.close();
  const failing = harness();
  const transport = failing.runtime.fetch;
  failing.runtime.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 403 })
        : transport(url, init),
    { preconnect: fetch.preconnect },
  );
  const second = await openCloudflareTail("worker", "run", failing.runtime);
  await second.close();
  expect(second.warnings).toContain(
    "Tail session deletion failed; it will expire automatically.",
  );
});
