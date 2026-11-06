import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch as fakeFetch,
  STRIPE_PAYLOAD_CHECKOUT as SYNC_SUBSCRIPTION_INPUT,
  STRIPE_PAYLOAD_PRICE as VALID_TEAM_5_PRICE,
} from "../../test/helpers/stripePayloadFetch";
import {
  createSyncSubscription,
  getStripeSyncOption,
  isStripeCheckoutConfigured,
  StripeApiError,
} from "./stripeApi";
import { findOrCreateCustomer } from "./stripeCustomer";

test("configuration requires both the secret key and the price id", () => {
  expect(isStripeCheckoutConfigured({ env: ENV })).toBe(true);
  expect(
    isStripeCheckoutConfigured({ env: { STRIPE_SECRET_KEY: "sk_test_123" } }),
  ).toBe(false);
  expect(isStripeCheckoutConfigured({ env: {} })).toBe(false);
  expect(
    isStripeCheckoutConfigured({
      env: { ...ENV, STRIPE_SYNC_TEAM_5_PRICE_ID: "price_solo" },
    }),
  ).toBe(false);
});

test("sync option maps the price with its product, pinned API version", async () => {
  const { fetchImpl, requests } = fakeFetch([
    {
      body: VALID_TEAM_5_PRICE,
    },
  ]);
  const option = await getStripeSyncOption("team_5", { env: ENV, fetchImpl });

  expect(option).toEqual({
    tierId: "team_5",
    seatLimit: 5,
    priceId: "price_sync",
    productName: "Team (up to 5)",
    currency: "usd",
    unitAmount: 1_000,
    interval: "month",
    intervalCount: 1,
  });
  expect(requests[0]?.url).toContain("/v1/prices/price_sync");
  expect(
    new URL(requests[0]?.url ?? "").searchParams.getAll("expand[]"),
  ).toEqual(["product"]);
  expect(requests[0]?.headers.get("Stripe-Version")).not.toBeNull();
  expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk_test_123");
});

test("subscription create binds org metadata and returns the client secret", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [] } },
    {
      body: {
        id: "sub_1",
        latest_invoice: { payment_intent: { client_secret: "pi_secret" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_1", clientSecret: "pi_secret" },
  });
  expect(requests[1]?.url).toContain("/v1/subscriptions/search");
  const body = requests[2]?.body ?? "";
  expect(body).toContain(`${encodeURIComponent("metadata[orgId]")}=org-1`);
  expect(body).toContain(`${encodeURIComponent("metadata[userId]")}=user-1`);
  expect(body).toContain("payment_behavior=default_incomplete");
  expect(body).toContain(
    `${encodeURIComponent("payment_settings[payment_method_types][]")}=card`,
  );
  expect(requests[2]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:attempt-1",
  );
});

test("an existing incomplete subscription is resumed, not duplicated", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [{ id: "sub_pending", status: "incomplete" }] } },
    {
      body: {
        id: "sub_pending",
        status: "incomplete",
        metadata: {
          checkoutAttemptId: "attempt-1",
          userId: "user-1",
          orgId: "org-1",
        },
        items: { data: [{ price: { id: "price_sync" }, quantity: 1 }] },
        latest_invoice: { payment_intent: { client_secret: "pi_resume" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_pending", clientSecret: "pi_resume" },
  });
  // Search, then resume — never a create.
  expect(requests).toHaveLength(3);
  expect(requests[2]?.method).toBe("GET");
});

test("a stale pending checkout is a conflict, never cancelled", async () => {
  // The pending attempt belongs to a different buyer (e.g. a since-removed
  // admin) or an obsolete price. It cannot be RESUMED (its buyer/price no
  // longer match) and must not be CANCELLED either — its client secret could
  // be mid-payment in another browser, and Stripe would not refund a
  // subscription that became paid moments before the cancel. The conflict
  // self-resolves when the attempt is paid or expires.
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [{ id: "sub_stale", status: "incomplete" }] } },
    {
      body: {
        id: "sub_stale",
        status: "incomplete",
        metadata: { userId: "user-gone", orgId: "org-1" },
        items: { data: [{ price: { id: "price_old" } }] },
        latest_invoice: { payment_intent: { client_secret: "pi_stale" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({ kind: "conflict" });
  // Search and inspect only — no cancel, no create.
  expect(requests).toHaveLength(3);
});

test("a live subscription for the org refuses a second checkout", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [{ id: "sub_live", status: "active" }] } },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({ kind: "conflict" });
  expect(requests).toHaveLength(2);
});

test("a candidate that expired since the search is recreated, not resumed", async () => {
  // The search index still reported `incomplete`, but the authoritative GET
  // shows the attempt expired — its old client secret is unusable, so a
  // fresh subscription is created under a rotated key.
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [{ id: "sub_gone", status: "incomplete" }] } },
    {
      body: {
        id: "sub_gone",
        status: "incomplete_expired",
        metadata: { checkoutAttemptId: "attempt-old" },
      },
    },
    {
      body: {
        id: "sub_next",
        latest_invoice: { payment_intent: { client_secret: "pi_next" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_next", clientSecret: "pi_next" },
  });
  expect(requests[3]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:attempt-1",
  );
});

test("a candidate that became active since the search is a conflict", async () => {
  const { fetchImpl } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    { body: { data: [{ id: "sub_won", status: "incomplete" }] } },
    { body: { id: "sub_won", status: "active" } },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });
  expect(outcome).toEqual({ kind: "conflict" });
});

test("a durable checkout attempt supplies the rotated idempotency key", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: VALID_TEAM_5_PRICE },
    // Expired attempts from older durable tokens do not affect the new token.
    {
      body: {
        data: [
          {
            id: "sub_older",
            status: "incomplete_expired",
            metadata: { checkoutAttemptId: "attempt-old" },
          },
        ],
      },
    },
    {
      body: {
        id: "sub_2",
        latest_invoice: { payment_intent: { client_secret: "pi_2" } },
      },
    },
  ]);
  const outcome = await createSyncSubscription(SYNC_SUBSCRIPTION_INPUT, {
    env: ENV,
    fetchImpl,
  });

  expect(outcome).toEqual({
    kind: "ready",
    intent: { subscriptionId: "sub_2", clientSecret: "pi_2" },
  });
  expect(requests[2]?.headers.get("Idempotency-Key")).toBe(
    "sync-sub:org-1:attempt-1",
  );
});

test("a failed Stripe request surfaces as StripeApiError with its status", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, body: {} }]);
  await expect(
    getStripeSyncOption("solo", { env: ENV, fetchImpl }),
  ).rejects.toBeInstanceOf(StripeApiError);
});

test("unconfigured environments read as null, never a network call", async () => {
  const { fetchImpl, requests } = fakeFetch([]);
  expect(await getStripeSyncOption("solo", { env: {}, fetchImpl })).toBeNull();
  expect(
    await findOrCreateCustomer(
      { userId: "u", organizationId: "o" },
      { env: {}, fetchImpl },
    ),
  ).toBeNull();
  expect(requests).toHaveLength(0);
});
