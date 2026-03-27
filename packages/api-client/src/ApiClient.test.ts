import { expect, test } from "bun:test";
import { ApiClient } from "./ApiClient";

test("includes authorization header after authentication", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ message: "ok" }));
  }) as unknown as typeof fetch;

  const client = new ApiClient("http://api.test");
  client.setAuthToken("abc");

  await client.getHealth();

  expect(calls[0]?.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer abc",
  });

  globalThis.fetch = originalFetch;
});

test("returns null on network error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;

  const client = new ApiClient("http://api.test");
  expect(await client.getHealth()).toBeNull();
  globalThis.fetch = originalFetch;
});
