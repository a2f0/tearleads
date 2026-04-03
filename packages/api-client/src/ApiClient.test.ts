import { expect, test } from "bun:test";
import { ApiClient } from "./ApiClient";

test("includes authorization header after authentication", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  const fetchMock = Object.assign(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ message: "ok" }));
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

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
  const fetchMock = Object.assign(
    async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new Error("offline");
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fetchMock;

  const client = new ApiClient("http://api.test");
  expect(await client.getHealth()).toBeNull();
  globalThis.fetch = originalFetch;
});
