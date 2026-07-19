import { expect, test } from "bun:test";
import { fetchRevenueCatManagementUrl } from "./revenueCatApi";

const ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_test",
  REVENUECAT_PROJECT_ID: "proj_1",
} as NodeJS.ProcessEnv;

function jsonFetch(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; auth: unknown }> } {
  const calls: Array<{ url: string; auth: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("Authorization"),
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("returns null when unconfigured, without calling the API", async () => {
  const { fetchImpl, calls } = jsonFetch({});
  const url = await fetchRevenueCatManagementUrl("user-1", {
    env: {} as NodeJS.ProcessEnv,
    fetchImpl,
  });
  expect(url).toBeNull();
  expect(calls).toHaveLength(0);
});

test("returns the access-giving subscription's management URL", async () => {
  const { fetchImpl, calls } = jsonFetch({
    items: [
      { status: "expired", gives_access: false, management_url: "https://old" },
      {
        status: "active",
        gives_access: true,
        management_url: "https://manage.example/x",
      },
    ],
  });
  const url = await fetchRevenueCatManagementUrl("user-1", {
    env: ENV,
    fetchImpl,
  });
  expect(url).toBe("https://manage.example/x");
  expect(calls[0]?.url).toBe(
    "https://api.revenuecat.com/v2/projects/proj_1/customers/user-1/subscriptions",
  );
  expect(calls[0]?.auth).toBe("Bearer sk_test");
});

test("returns null when no subscription exposes a URL", async () => {
  const { fetchImpl } = jsonFetch({
    items: [{ status: "expired", gives_access: false, management_url: null }],
  });
  const url = await fetchRevenueCatManagementUrl("user-1", {
    env: ENV,
    fetchImpl,
  });
  expect(url).toBeNull();
});

test("returns null for a missing customer (404) or a server error", async () => {
  const notFound = jsonFetch({ message: "not found" }, 404);
  expect(
    await fetchRevenueCatManagementUrl("user-1", {
      env: ENV,
      fetchImpl: notFound.fetchImpl,
    }),
  ).toBeNull();

  const serverError = jsonFetch({}, 500);
  expect(
    await fetchRevenueCatManagementUrl("user-1", {
      env: ENV,
      fetchImpl: serverError.fetchImpl,
    }),
  ).toBeNull();
});

test("returns null (never throws) when the request errors", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const url = await fetchRevenueCatManagementUrl("user-1", {
    env: ENV,
    fetchImpl,
  });
  expect(url).toBeNull();
});
