import { afterEach, expect, test } from "bun:test";
import { runWithBunFetchLock } from "../src/bunFetchLock";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("only file URLs bypass the installed fetch while the lock is held", async () => {
  const intercepted: string[] = [];
  const interceptingFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      intercepted.push(input instanceof Request ? input.url : String(input));
      return new Response("intercepted");
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = interceptingFetch;

  const result = await runWithBunFetchLock(async () => {
    // A request from unrelated code that lands while the loader runs, as an
    // app's API call can, must still reach the fetch a test installed.
    const api = await fetch("http://127.0.0.1:9/api", { method: "GET" });
    const apiRequest = await fetch(new Request("http://127.0.0.1:9/request"));
    const asset = await fetch(import.meta.url);
    return {
      api: await api.text(),
      apiRequest: await apiRequest.text(),
      asset: await asset.text(),
    };
  });

  expect(result.api).toBe("intercepted");
  expect(result.apiRequest).toBe("intercepted");
  expect(result.asset).toContain("only file URLs bypass the installed fetch");
  expect(intercepted).toEqual([
    "http://127.0.0.1:9/api",
    "http://127.0.0.1:9/request",
  ]);
  expect(globalThis.fetch).toBe(interceptingFetch);
});
