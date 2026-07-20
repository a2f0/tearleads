import { expect, test } from "bun:test";
import {
  associateStripeSubscription,
  isRevenueCatAssociationConfigured,
  RevenueCatAssociationError,
} from "./revenueCatStripeAssociation";

const ENV = {
  REVENUECAT_V2_SECRET_KEY: "sk_rc_secret",
  REVENUECAT_PROJECT_ID: "proj_1",
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

test("association creates the customer, attributes it, then posts the receipt", async () => {
  const { fetchImpl, requests } = fakeFetch();
  await associateStripeSubscription(
    { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
    { env: ENV, fetchImpl },
  );

  expect(requests).toHaveLength(3);
  // Customer first: the v2 attributes endpoint 404s for an unknown customer
  // (v1 upserted one), so it cannot be the opening call.
  expect(requests[0]?.url).toContain("/v2/projects/proj_1/customers");
  expect(requests[0]?.body).toEqual({ id: "user-1" });
  expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk_rc_secret");

  expect(requests[1]?.url).toContain(
    "/v2/projects/proj_1/customers/user-1/attributes",
  );
  // v2 takes an array of {name, value}, not v1's keyed object.
  expect(requests[1]?.body).toEqual({
    attributes: [{ name: "orgId", value: "org-1" }],
  });

  // The receipt has no v2 equivalent and uses the Stripe app PUBLIC key.
  expect(requests[2]?.url).toContain("/v1/receipts");
  expect(requests[2]?.headers.get("Authorization")).toBe("Bearer strp_public");
  expect(requests[2]?.headers.get("X-Platform")).toBe("stripe");
  expect(requests[2]?.body).toEqual({
    app_user_id: "user-1",
    fetch_token: "sub_1",
  });
});

test("an already-existing customer (409) is success, not a failure", async () => {
  // A redelivered webhook — or a buyer whose app session already created the
  // customer — must not abort the association.
  const { fetchImpl, requests } = fakeFetch([409]);
  await associateStripeSubscription(
    { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
    { env: ENV, fetchImpl },
  );
  expect(requests).toHaveLength(3);
});

test("a failed customer create stops the flow before anything else", async () => {
  const { fetchImpl, requests } = fakeFetch([500]);
  await expect(
    associateStripeSubscription(
      { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
      { env: ENV, fetchImpl },
    ),
  ).rejects.toBeInstanceOf(RevenueCatAssociationError);
  expect(requests).toHaveLength(1);
});

test("a failed attribute write stops the flow before the receipt", async () => {
  const { fetchImpl, requests } = fakeFetch([200, 500]);
  await expect(
    associateStripeSubscription(
      { appUserId: "user-1", organizationId: "org-1", subscriptionId: "sub_1" },
      { env: ENV, fetchImpl },
    ),
  ).rejects.toBeInstanceOf(RevenueCatAssociationError);
  expect(requests).toHaveLength(2);
});

test("configuration needs the v2 key, the project id, and the Stripe key", async () => {
  const { fetchImpl } = fakeFetch();
  expect(isRevenueCatAssociationConfigured(ENV)).toBe(true);
  expect(isRevenueCatAssociationConfigured({})).toBe(false);
  // A missing project id is as disabling as a missing key: the v2 paths are
  // project-scoped.
  const { REVENUECAT_PROJECT_ID: _omitted, ...noProject } = ENV;
  expect(isRevenueCatAssociationConfigured(noProject)).toBe(false);
  await expect(
    associateStripeSubscription(
      { appUserId: "u", organizationId: "o", subscriptionId: "s" },
      { env: {}, fetchImpl },
    ),
  ).rejects.toBeInstanceOf(RevenueCatAssociationError);
});
