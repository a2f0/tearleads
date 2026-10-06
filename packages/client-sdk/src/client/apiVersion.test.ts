import { expect, test } from "bun:test";
import { apiVersionHeaderName } from "@tearleads/validators/operation";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { ApiVersion } from "./apiVersion";
import { Tearleads } from "./Tearleads";

test("tracks the latest API build and notifies only on change", () => {
  const apiVersion = new ApiVersion();
  const seen: number[] = [];
  const unsubscribe = apiVersion.subscribe((version) => seen.push(version));

  expect(apiVersion.current).toBeNull();
  apiVersion.observe(2460);
  apiVersion.observe(2460);
  apiVersion.observe(2461);
  // A rollback is reported as it happened rather than masked by the newer build.
  apiVersion.observe(2459);
  unsubscribe();
  apiVersion.observe(2462);

  expect(seen).toEqual([2460, 2461, 2459]);
  expect(apiVersion.current).toBe(2462);
});

test("the client records the build named by its API responses", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ sessions: [] }), {
      headers: {
        "content-type": "application/json",
        [apiVersionHeaderName]: "2461",
      },
      status: 200,
    })) as unknown as typeof fetch;

  try {
    const sdk = new Tearleads({
      apiBaseUrl: "https://api.example.test",
      logger: quietLogger,
    });
    expect(sdk.apiVersion.current).toBeNull();

    await expect(sdk.session.listSessions()).resolves.toEqual([]);

    expect(sdk.apiVersion.current).toBe(2461);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
