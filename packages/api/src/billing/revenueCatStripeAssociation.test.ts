import { expect, test } from "bun:test";
import {
  associateStripeSubscription,
  isRevenueCatAssociationConfigured,
  RevenueCatAssociationError,
} from "./revenueCatStripeAssociation";

const ENV = {
  REVENUECAT_SECRET_API_KEY: "sk_rc_secret",
  REVENUECAT_STRIPE_PUBLIC_API_KEY: "strp_public",
};

interface RecordedRequest {
  url: string;
  body: unknown;
  headers: Headers;
}

function fakeFetch(statuses: number[] = []): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    });
    const status = statuses.shift() ?? 200;
    return new Response("{}", { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test("association sets the org attribute BEFORE posting the receipt", async () => {
  const { fetchImpl, requests } = fakeFetch();
  await associateStripeSubscription(
    { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
    { env: ENV, fetchImpl },
  );

  expect(requests).toHaveLength(2);
  // Attribute first: the receipt creates the INITIAL_PURCHASE event, whose org
  // resolution reads the subscriber attributes at event time.
  expect(requests[0]?.url).toContain("/v1/subscribers/user-1/attributes");
  expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk_rc_secret");
  expect(requests[0]?.body).toEqual({
    attributes: {
      orgId: { value: "org-1", updated_at_ms: expect.any(Number) },
    },
  });
  expect(requests[1]?.url).toContain("/v1/receipts");
  expect(requests[1]?.headers.get("Authorization")).toBe("Bearer strp_public");
  expect(requests[1]?.headers.get("X-Platform")).toBe("stripe");
  expect(requests[1]?.body).toEqual({
    app_user_id: "user-1",
    fetch_token: "sub_1",
  });
});

test("a failed attribute write stops the flow before the receipt", async () => {
  const { fetchImpl, requests } = fakeFetch([500]);
  expect(
    associateStripeSubscription(
      { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
      { env: ENV, fetchImpl },
    ),
  ).rejects.toBeInstanceOf(RevenueCatAssociationError);
  await Promise.resolve();
  expect(requests).toHaveLength(1);
});

test("unconfigured association throws instead of silently dropping", () => {
  const { fetchImpl } = fakeFetch();
  expect(isRevenueCatAssociationConfigured(ENV)).toBe(true);
  expect(isRevenueCatAssociationConfigured({})).toBe(false);
  expect(
    associateStripeSubscription(
      { appUserId: "u", organizationId: "o", subscriptionId: "s" },
      { env: {}, fetchImpl },
    ),
  ).rejects.toBeInstanceOf(RevenueCatAssociationError);
});
