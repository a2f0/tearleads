import { expect, test } from "bun:test";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "./organizationBilling";
import {
  BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  classifyRevenueCatEvent,
  readRevenueCatWebhookAuthToken,
  resolveOrganizationIdFromEvent,
  resolveStripeStoreOrganizationId,
} from "./revenuecatWebhook";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_GRANT_NOW = new Date(1_500);

function makeEvent(
  overrides: Partial<RevenueCatWebhookEvent> = {},
): RevenueCatWebhookEvent {
  return {
    id: "event-1",
    type: "INITIAL_PURCHASE",
    app_user_id: "user-1",
    event_timestamp_ms: 1_000,
    purchased_at_ms: 500,
    expiration_at_ms: 2_000,
    product_id: "sync_solo_monthly",
    transaction_id: "transaction-1",
    original_transaction_id: "original-transaction-1",
    entitlement_ids: ["sync"],
    subscriber_attributes: { orgId: { value: ORG_ID } },
    ...overrides,
  };
}

test("a purchase event classifies as a grant that activates sync", () => {
  const transition = classifyRevenueCatEvent(makeEvent(), ACTIVE_GRANT_NOW);
  expect(transition.kind).toBe("grant");
  if (transition.kind !== "grant") {
    throw new Error("expected a grant");
  }
  expect(transition.fields).toMatchObject({
    currentPeriodEndsAt: new Date(2_000),
    currentPeriodStartsAt: new Date(500),
    disabledAt: null,
    entitlementId: "sync",
    provider: "revenuecat",
    providerCustomerId: "user-1",
    providerProductId: "sync_solo_monthly",
    providerSubscriptionId: "original-transaction-1",
    providerTransactionId: "transaction-1",
    purgeAfter: null,
    status: "active",
    trialEndsAt: null,
    trialExpiryAttemptCount: 0,
    trialExpiryLastError: null,
    trialExpiryNextAttemptAt: null,
  });
});

test("RevenueCat Web Billing grants fail closed", () => {
  expect(
    classifyRevenueCatEvent(
      makeEvent({ store: "RC_BILLING" }),
      ACTIVE_GRANT_NOW,
    ),
  ).toEqual({
    kind: "ignore",
    reason: "RevenueCat Web Billing grants are not supported",
  });
});

test("a Stripe grant takes capacity from its immutable subscription binding", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({
      product_id: "prod_revenuecat_catalog_id",
      store: "STRIPE",
    }),
    ACTIVE_GRANT_NOW,
    { stripePriceId: "price_team_5", stripeSeatCount: 5 },
  );

  expect(transition.kind).toBe("grant");
  if (transition.kind === "grant") {
    expect(transition.fields.providerProductId).toBe("price_team_5");
    expect(transition.fields.seatCount).toBe(5);
  }
});

test("a native product change waits for the effective store event", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({
      new_product_id: "sync_team_5_monthly",
      product_id: "sync_solo_monthly",
      store: "APP_STORE",
      type: "PRODUCT_CHANGE",
    }),
    ACTIVE_GRANT_NOW,
  );

  expect(transition).toEqual({
    kind: "ignore",
    reason: BOUND_REVENUECAT_PRODUCT_CHANGE_REQUIRED_REASON,
  });
});

test("a native product change without a configured destination fails closed", () => {
  expect(
    classifyRevenueCatEvent(
      makeEvent({
        new_product_id: null,
        store: "APP_STORE",
        type: "PRODUCT_CHANGE",
      }),
      ACTIVE_GRANT_NOW,
    ).kind,
  ).toBe("ignore");
});

test("a grant without an expiration has a null period end", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({ expiration_at_ms: null }),
    ACTIVE_GRANT_NOW,
  );
  expect(
    transition.kind === "grant" && transition.fields.currentPeriodEndsAt,
  ).toBeNull();
});

test("an already-expired grant is ignored instead of writing active billing", () => {
  const transition = classifyRevenueCatEvent(
    makeEvent({ expiration_at_ms: 1_000 }),
    new Date(2_000),
  );
  expect(transition).toEqual({
    kind: "ignore",
    reason: "Grant event period has already expired",
  });
});

test("an expiration event classifies as a revoke that disables sync", () => {
  const now = new Date(10_000);
  const transition = classifyRevenueCatEvent(
    makeEvent({ type: "EXPIRATION" }),
    now,
  );
  expect(transition.kind).toBe("revoke");
  if (transition.kind !== "revoke") {
    throw new Error("expected a revoke");
  }
  expect(transition.fields.status).toBe("disabled");
  expect(transition.fields.disabledAt).toEqual(now);
  expect(transition.fields.purgeAfter).toEqual(
    new Date(now.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
  );
  expect(transition.fields).toMatchObject({
    trialExpiryAttemptCount: 0,
    trialExpiryLastError: null,
    trialExpiryNextAttemptAt: null,
  });
});

test("a cancellation is ignored because the entitlement stays active", () => {
  expect(
    classifyRevenueCatEvent(makeEvent({ type: "CANCELLATION" })).kind,
  ).toBe("ignore");
});

test("an unknown event type is ignored", () => {
  expect(
    classifyRevenueCatEvent(makeEvent({ type: "SOMETHING_NEW" })).kind,
  ).toBe("ignore");
});

test("resolveOrganizationIdFromEvent reads the orgId subscriber attribute", () => {
  expect(resolveOrganizationIdFromEvent(makeEvent())).toBe(ORG_ID);
});

test("resolveOrganizationIdFromEvent prefers the transaction metadata orgId", () => {
  // The metadata is stamped per purchase and immutable, while the subscriber
  // attribute is customer-level and rebindable by any later purchase — a late
  // completion must be attributed to the org the purchase was started for.
  const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({
        metadata: { orgId: ORG_ID },
        subscriber_attributes: { orgId: { value: OTHER_ORG_ID } },
      }),
    ),
  ).toBe(ORG_ID);
});

test("resolveOrganizationIdFromEvent falls back to the attribute on bad metadata", () => {
  // Native purchases carry no metadata, and a malformed value must not mask a
  // valid attribute binding.
  expect(resolveOrganizationIdFromEvent(makeEvent({ metadata: null }))).toBe(
    ORG_ID,
  );
  expect(resolveOrganizationIdFromEvent(makeEvent({ metadata: {} }))).toBe(
    ORG_ID,
  );
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({ metadata: { orgId: "not-a-uuid" } }),
    ),
  ).toBe(ORG_ID);
  expect(
    resolveOrganizationIdFromEvent(makeEvent({ metadata: { orgId: 42 } })),
  ).toBe(ORG_ID);
});

test("resolveOrganizationIdFromEvent rejects a missing or malformed org id", () => {
  expect(
    resolveOrganizationIdFromEvent({
      app_user_id: "user-1",
      event_timestamp_ms: 1_000,
      id: "event-1",
      type: "INITIAL_PURCHASE",
    }),
  ).toBeNull();
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({ subscriber_attributes: { orgId: { value: "not-a-uuid" } } }),
    ),
  ).toBeNull();
  expect(
    resolveOrganizationIdFromEvent(
      makeEvent({ subscriber_attributes: { orgId: { value: null } } }),
    ),
  ).toBeNull();
});

test("readRevenueCatWebhookAuthToken reads and trims the configured secret", () => {
  expect(
    readRevenueCatWebhookAuthToken({
      REVENUECAT_WEBHOOK_AUTH_HEADER: " s3cret ",
    }),
  ).toBe("s3cret");
  expect(readRevenueCatWebhookAuthToken({})).toBeNull();
  expect(
    readRevenueCatWebhookAuthToken({ REVENUECAT_WEBHOOK_AUTH_HEADER: "  " }),
  ).toBeNull();
});

test("Stripe-store events resolve their org from the subscription binding", async () => {
  const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
  const stripeEnv = {
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
  };
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_1",
        status: "active",
        items: {
          data: [{ id: "si_1", price: { id: "price_sync" }, quantity: 1 }],
        },
        metadata: { userId: "user-1", orgId: ORG_ID },
      }),
    )) as typeof fetch;

  // The customer-level attribute was rebound to another org by a later
  // purchase; the subscription's own metadata must win for Stripe events.
  const resolved = await resolveStripeStoreOrganizationId(
    makeEvent({
      store: "STRIPE",
      original_transaction_id: "sub_1",
      subscriber_attributes: { orgId: { value: OTHER_ORG_ID } },
    }),
    { env: stripeEnv, fetchImpl },
  );
  expect(resolved).toEqual({
    kind: "resolved",
    organizationId: ORG_ID,
    priceId: "price_sync",
    seatCount: 1,
  });

  // Non-Stripe stores fall through to ordinary resolution. A Stripe event
  // without an immutable identifier fails closed.
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({ store: "RC_BILLING", original_transaction_id: "sub_1" }),
      { env: stripeEnv, fetchImpl },
    ),
  ).toEqual({ kind: "none" });
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({
        store: "STRIPE",
        original_transaction_id: null,
        transaction_id: null,
      }),
      { env: stripeEnv, fetchImpl },
    ),
  ).toEqual({ kind: "error" });
});

test("failed and unconfigured Stripe lookups both defer", async () => {
  // Falling back to the mutable subscriber attribute could attribute a
  // multi-org buyer's event to the wrong organization AND claim the event id,
  // making the misattribution permanent — the caller defers instead.
  const failingFetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => new Response("{}", { status: 500 })) as typeof fetch;
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({ store: "STRIPE", original_transaction_id: "sub_1" }),
      {
        env: { STRIPE_SECRET_KEY: "sk", STRIPE_SYNC_SOLO_PRICE_ID: "p" },
        fetchImpl: failingFetch,
      },
    ),
  ).toEqual({ kind: "error" });
  // Missing configuration must not turn the mutable customer attribute into
  // an identity source either.
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({ store: "STRIPE", original_transaction_id: "sub_1" }),
      { env: {}, fetchImpl: failingFetch },
    ),
  ).toEqual({ kind: "error" });
});

test("an si_ identifier is verified by an accompanying exact subscription", async () => {
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_1",
        items: {
          data: [{ id: "si_1", price: { id: "price_sync" }, quantity: 1 }],
        },
        metadata: { orgId: ORG_ID },
      }),
    )) as typeof fetch;
  const deps = {
    env: {
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
    },
    fetchImpl,
  };

  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({
        original_transaction_id: "si_1",
        store: "STRIPE",
        transaction_id: "sub_1",
      }),
      deps,
    ),
  ).toEqual({
    kind: "resolved",
    organizationId: ORG_ID,
    priceId: "price_sync",
    seatCount: 1,
  });
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({
        original_transaction_id: "si_other",
        store: "STRIPE",
        transaction_id: "sub_1",
      }),
      deps,
    ),
  ).toEqual({ kind: "error" });
});

test("Stripe-store grants fall back to transaction_id for the subscription", () => {
  const stripeGrant = classifyRevenueCatEvent(
    makeEvent({
      store: "STRIPE",
      original_transaction_id: null,
      transaction_id: "sub_only",
    }),
    ACTIVE_GRANT_NOW,
    { stripeSeatCount: 1 },
  );
  // Without the fallback the billing row would store no subscription id and
  // the Billing Portal could never resolve this org's subscription.
  expect(
    stripeGrant.kind === "grant" && stripeGrant.fields.providerSubscriptionId,
  ).toBe("sub_only");

  // Other stores keep the canonical original transaction id semantics.
  const appStoreGrant = classifyRevenueCatEvent(
    makeEvent({
      store: "APP_STORE",
      original_transaction_id: null,
      transaction_id: "1000000",
    }),
    ACTIVE_GRANT_NOW,
  );
  expect(
    appStoreGrant.kind === "grant" &&
      appStoreGrant.fields.providerSubscriptionId,
  ).toBeNull();
});

test("a missing Stripe subscription fails closed", async () => {
  const notFoundFetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => new Response("{}", { status: 404 })) as typeof fetch;
  expect(
    await resolveStripeStoreOrganizationId(
      makeEvent({ store: "STRIPE", original_transaction_id: "sub_legacy" }),
      {
        env: { STRIPE_SECRET_KEY: "sk", STRIPE_SYNC_SOLO_PRICE_ID: "p" },
        fetchImpl: notFoundFetch,
      },
    ),
  ).toEqual({ kind: "error" });
});
