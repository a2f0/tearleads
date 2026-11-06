import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch as fakeFetch,
} from "../../test/helpers/stripePayloadFetch";
import {
  cancelSubscriptionAtPeriodEnd,
  createPortalSession,
  findLiveOrgSubscription,
} from "./stripeSubscriptionManagement";

test("portal session returns the hosted url", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: { url: "https://billing.stripe.com/p/session" } },
  ]);
  const url = await createPortalSession(
    { customerId: "cus_1", returnUrl: "https://app.example/billing" },
    { env: ENV, fetchImpl },
  );

  expect(url).toBe("https://billing.stripe.com/p/session");
  expect(requests[0]?.body).toContain("customer=cus_1");
});

test("cancelling schedules the end of the paid period, not an instant stop", async () => {
  // `cancel_at_period_end` keeps the sync the buyer already paid for, and lets
  // RevenueCat flip the entitlement through the same path a lapsed renewal
  // takes — an immediate delete would revoke access mid-period.
  const { fetchImpl, requests } = fakeFetch([
    { body: { id: "sub_1", cancel_at: 1893456000 } },
  ]);
  const result = await cancelSubscriptionAtPeriodEnd("sub_1", {
    env: ENV,
    fetchImpl,
  });

  expect(result).toEqual({ cancelAt: 1893456000 });
  expect(requests[0]?.url).toContain("/v1/subscriptions/sub_1");
  expect(requests[0]?.body).toContain("cancel_at_period_end=true");
  expect(requests[0]?.body ?? "").not.toContain("cancel_at_period_end=false");
});

test("a cancellation without a resolved date still reports success", async () => {
  // Stripe omits `cancel_at` on an already-cancelling subscription; the panel
  // must treat that as cancelled rather than as a failure.
  const { fetchImpl } = fakeFetch([{ body: { id: "sub_1" } }]);

  expect(
    await cancelSubscriptionAtPeriodEnd("sub_1", { env: ENV, fetchImpl }),
  ).toEqual({ cancelAt: null });
});

test("findLiveOrgSubscription returns the live sub_ and its customer", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_live",
            status: "active",
            customer: "cus_1",
            metadata: { orgId: "org-1", userId: "user-1" },
          },
        ],
      },
    },
  ]);

  const found = await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl });

  expect(found).toEqual({ subscriptionId: "sub_live", customerId: "cus_1" });
  // Resolved by searching on our own orgId metadata, not a stored id.
  expect(requests[0]?.url).toContain("/v1/subscriptions/search");
  expect(requests[0]?.url).toContain(encodeURIComponent("metadata['orgId']"));
});

test("findLiveOrgSubscription ignores an incomplete-only result", async () => {
  // An abandoned checkout: nothing is billing, so there is nothing to manage.
  const { fetchImpl } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_incomplete",
            status: "incomplete",
            customer: "cus_1",
            metadata: { orgId: "org-1" },
          },
        ],
      },
    },
  ]);

  expect(
    await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).toBeNull();
});

test("findLiveOrgSubscription rejects a result whose metadata names another org", async () => {
  // Defense-in-depth over the metadata search: never hand back a customer
  // whose Billing Portal would expose an unrelated org's subscriptions.
  const { fetchImpl } = fakeFetch([
    {
      body: {
        data: [
          {
            id: "sub_other",
            status: "active",
            customer: "cus_other",
            metadata: { orgId: "org-2" },
          },
        ],
      },
    },
  ]);

  expect(
    await findLiveOrgSubscription("org-1", { env: ENV, fetchImpl }),
  ).toBeNull();
});

test("findLiveOrgSubscription is null without a secret key", async () => {
  const { fetchImpl, requests } = fakeFetch([]);

  expect(
    await findLiveOrgSubscription("org-1", { env: {}, fetchImpl }),
  ).toBeNull();
  // Never reached Stripe.
  expect(requests).toHaveLength(0);
});
