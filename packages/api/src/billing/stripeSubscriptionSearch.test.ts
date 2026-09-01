import { expect, test } from "bun:test";
import { findLiveOrgSubscription, hasOpenOrgSubscription } from "./stripeApi";

const ENV = { STRIPE_SECRET_KEY: "sk_test_123" };

function fakeFetch(responses: unknown[]): {
  fetchImpl: typeof fetch;
  requests: string[];
} {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json(responses.shift() ?? {});
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function terminalSubscriptions(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `sub_expired_${index}`,
    status: "incomplete_expired",
  }));
}

test("duplicate detection finds a live subscription after the first 100 results", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      data: terminalSubscriptions(100),
      has_more: true,
      next_page: "next/page?2",
    },
    { data: [{ id: "sub_live", status: "active" }], has_more: false },
  ]);

  expect(await hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl })).toBe(
    true,
  );
  expect(requests).toHaveLength(2);
  expect(new URL(requests[0] ?? "").searchParams.has("page")).toBe(false);
  expect(new URL(requests[1] ?? "").searchParams.get("page")).toBe(
    "next/page?2",
  );
});

test("portal and cancellation resolver finds a live subscription on a later page", async () => {
  const { fetchImpl } = fakeFetch([
    {
      data: terminalSubscriptions(100),
      has_more: true,
      next_page: "page-2",
    },
    {
      data: [
        {
          id: "sub_live",
          status: "active",
          customer: "cus_1",
          metadata: { orgId: "org-1" },
        },
      ],
      has_more: false,
    },
  ]);

  expect(
    await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).toEqual({ subscriptionId: "sub_live", customerId: "cus_1" });
});

test("subscription search rejects a missing next-page cursor", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { data: terminalSubscriptions(100), has_more: true },
  ]);

  await expect(
    hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).rejects.toMatchObject({
    name: "StripeApiError",
    status: 502,
  });
  expect(requests).toHaveLength(1);
});

test("subscription search rejects a repeated next-page cursor", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { data: [], has_more: true, next_page: "page-2" },
    { data: [], has_more: true, next_page: "page-2" },
  ]);

  await expect(
    hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).rejects.toMatchObject({
    name: "StripeApiError",
    status: 502,
  });
  expect(requests).toHaveLength(2);
});

test("subscription search rejects traversal beyond its page bound", async () => {
  let requestCount = 0;
  const fetchImpl = (async (_input: RequestInfo | URL) => {
    requestCount += 1;
    return Response.json({
      data: [],
      has_more: true,
      next_page: `page-${requestCount + 1}`,
    });
  }) as typeof fetch;

  await expect(
    hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).rejects.toMatchObject({
    name: "StripeApiError",
    status: 502,
  });
  expect(requestCount).toBe(100);
});

test("subscription search rejects malformed page data", async () => {
  const { fetchImpl } = fakeFetch([{ data: null, has_more: false }]);

  await expect(
    hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).rejects.toMatchObject({
    name: "StripeApiError",
    status: 502,
  });
});

test("subscription search rejects a missing pagination indicator", async () => {
  const { fetchImpl } = fakeFetch([{ data: [] }]);

  await expect(
    hasOpenOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).rejects.toMatchObject({
    name: "StripeApiError",
    status: 502,
  });
});
