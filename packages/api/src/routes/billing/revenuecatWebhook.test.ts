import { beforeAll, expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import {
  addSyntheticMember,
  postRevenueCatWebhook as postWebhook,
  readOrganizationBilling as readBilling,
  registerAndAuthenticate,
  THIRTY_DAYS_MS,
  REVENUECAT_WEBHOOK_SECRET as WEBHOOK_SECRET,
  revenuecatWebhookBody as webhookBody,
} from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "../../workflows/billing/revenuecatWebhook";

const LAPSED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_ENV_KEY = "REVENUECAT_WEBHOOK_AUTH_HEADER";

beforeAll(() => {
  process.env[AUTH_ENV_KEY] = WEBHOOK_SECRET;
});

test("rejects a webhook with a missing or wrong authorization header", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const missing = await postWebhook(
    webhookBody({ appUserId: admin.userId, organizationId, type: "RENEWAL" }),
    null,
  );
  expect(missing.status).toBe(401);

  const wrong = await postWebhook(
    webhookBody({ appUserId: admin.userId, organizationId, type: "RENEWAL" }),
    "Bearer nope",
  );
  expect(wrong.status).toBe(401);
});

test("rejects a malformed webhook payload", async () => {
  const invalidJson = await postWebhook("not json");
  expect(invalidJson.status).toBe(400);

  const missingEvent = await postWebhook(
    JSON.stringify({ api_version: "1.0" }),
  );
  expect(missingEvent.status).toBe(400);

  const invalidTimestamp = await postWebhook(
    webhookBody({
      appUserId: crypto.randomUUID(),
      eventTimestampMs: 9_000_000_000_000_000,
      organizationId: crypto.randomUUID(),
      type: "RENEWAL",
    }),
  );
  expect(invalidTimestamp.status).toBe(400);
});

test("an admin purchase activates org sync and records the provider", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const purchasedAtMs = Date.now();
  const expirationAtMs = Date.now() + THIRTY_DAYS_MS;

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      expirationAtMs,
      originalTransactionId: "original-transaction-1",
      organizationId,
      productId: "sync_monthly",
      purchasedAtMs,
      store: "APP_STORE",
      transactionId: "transaction-1",
      type: "INITIAL_PURCHASE",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const billing = await readBilling(organizationId);
  expect(billing.status).toBe("active");
  expect(billing.provider).toBe("revenuecat");
  expect(billing.providerCustomerId).toBe(admin.userId);
  expect(billing.providerSubscriptionId).toBe("original-transaction-1");
  expect(billing.providerProductId).toBe("sync_monthly");
  expect(billing.providerTransactionId).toBe("transaction-1");
  expect(billing.entitlementId).toBe("sync");
  expect(billing.currentPeriodStartsAt?.getTime()).toBe(purchasedAtMs);
  expect(billing.currentPeriodEndsAt?.getTime()).toBe(expirationAtMs);
  expect(billing.seatCount).toBe(1);
  expect(billing.disabledAt).toBeNull();
  expect(billing.purgeAfter).toBeNull();
});

test("a native team purchase grants the fixed tier capacity", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      productId: "sync_team_5_monthly",
      store: "APP_STORE",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(await response.json()).toEqual({ received: true, outcome: "applied" });
  expect(await readBilling(organizationId)).toMatchObject({
    providerProductId: "sync_team_5_monthly",
    seatCount: 5,
    status: "active",
  });
});

test("a paid native tier activates but freezes an oversized roster", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await addSyntheticMember(admin, organizationId);
  await setTestOrganizationBillingLocal(organizationId);
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_cancelled",
    subscriptionId: `sub_cancelled_${organizationId}`,
    subscriptionItemId: `si_cancelled_${organizationId}`,
  });

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      productId: "sync_solo_monthly",
      store: "APP_STORE",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(await response.json()).toEqual({ received: true, outcome: "applied" });
  expect(await readBilling(organizationId)).toMatchObject({
    providerCustomerId: admin.userId,
    providerProductId: "sync_solo_monthly",
    seatCount: 1,
    status: "active",
  });
  const staleStripeRows = await db
    .select({ id: organizationBillingStripeSeats.id })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(staleStripeRows).toHaveLength(0);
});

test("a native purchase cannot fund a custom organization", async () => {
  const admin = createTestUser();
  const personalOrganizationId = await registerAndAuthenticate(admin);
  const request = await createOrganizationRequestBody(admin);
  const created = await submitCreateOrganization(admin, request);
  expect(created.status).toBe(200);
  expect(request.organizationId).not.toBe(personalOrganizationId);
  await setTestOrganizationBillingLocal(request.organizationId);

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId: request.organizationId,
      productId: "sync_team_5_monthly",
      store: "APP_STORE",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(await response.json()).toEqual({ received: true, outcome: "ignored" });
  expect(await readBilling(request.organizationId)).toMatchObject({
    providerCustomerId: null,
    status: "local",
  });
});

test("a promotional grant can fund an admin's custom organization", async () => {
  const admin = createTestUser();
  await registerAndAuthenticate(admin);
  const request = await createOrganizationRequestBody(admin);
  const created = await submitCreateOrganization(admin, request);
  expect(created.status).toBe(200);
  await setTestOrganizationBillingLocal(request.organizationId);

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId: request.organizationId,
      productId: "sync_team_5_monthly",
      store: "PROMOTIONAL",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(await response.json()).toEqual({ received: true, outcome: "applied" });
  expect(await readBilling(request.organizationId)).toMatchObject({
    providerCustomerId: admin.userId,
    providerProductId: "promotional:sync_team_5_monthly",
    seatCount: 5,
    status: "active",
  });
});

test("a duplicate event id is processed only once", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const eventId = crypto.randomUUID();
  const body = webhookBody({
    appUserId: admin.userId,
    eventId,
    organizationId,
    type: "INITIAL_PURCHASE",
  });

  const first = await postWebhook(body);
  expect(await first.json()).toEqual({ received: true, outcome: "applied" });

  const second = await postWebhook(body);
  expect(await second.json()).toEqual({
    received: true,
    outcome: "duplicate",
  });

  const rows = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(rows).toHaveLength(1);
});

test("an expiration event disables sync and opens the purge grace window", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const billing = await readBilling(organizationId);
  expect(billing.status).toBe("disabled");
  invariant(billing.disabledAt, "expected disabledAt");
  invariant(billing.purgeAfter, "expected purgeAfter");
  expect(billing.purgeAfter.getTime() - billing.disabledAt.getTime()).toBe(
    LAPSED_GRACE_MS,
  );
});

test("a renewal after an expiration re-activates sync and clears the purge window", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  const disabled = await readBilling(organizationId);
  expect(disabled.status).toBe("disabled");
  invariant(disabled.disabledAt, "expected disabledAt after expiration");
  invariant(disabled.purgeAfter, "expected purgeAfter after expiration");

  // A renewal must reactivate sync and clear the pending-purge fields.
  const expirationAtMs = Date.now() + THIRTY_DAYS_MS;
  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      expirationAtMs,
      organizationId,
      type: "RENEWAL",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "applied" });

  const reactivated = await readBilling(organizationId);
  expect(reactivated.status).toBe("active");
  expect(reactivated.currentPeriodEndsAt?.getTime()).toBe(expirationAtMs);
  expect(reactivated.disabledAt).toBeNull();
  expect(reactivated.purgeAfter).toBeNull();
});

test("a non-admin buyer is ignored and does not activate sync", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);

  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const response = await postWebhook(
    webhookBody({
      appUserId: intruder.userId,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, outcome: "ignored" });

  const billing = await readBilling(organizationId);
  expect(billing.status).toBe("local");
  expect(billing.providerCustomerId).toBeNull();
});

test("a cancellation leaves an active subscription untouched", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);

  await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      organizationId,
      type: "CANCELLATION",
    }),
  );
  expect(await response.json()).toEqual({ received: true, outcome: "ignored" });

  const billing = await readBilling(organizationId);
  expect(billing.status).toBe("active");
});

test("a stale out-of-order event does not overwrite newer applied billing", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const newer = Date.now();

  const purchase = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      eventTimestampMs: newer,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );
  expect(await purchase.json()).toEqual({ received: true, outcome: "applied" });

  // A late pre-purchase EXPIRATION must not disable the fresh purchase.
  const staleExpiration = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      eventTimestampMs: newer - 60_000,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  expect(await staleExpiration.json()).toEqual({
    received: true,
    outcome: "ignored",
  });

  expect((await readBilling(organizationId)).status).toBe("active");
});

test("an expired grant event records ignored and does not activate sync", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);

  const response = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      eventTimestampMs: Date.now(),
      expirationAtMs: Date.now() - 60_000,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(await response.json()).toEqual({ received: true, outcome: "ignored" });
  expect((await readBilling(organizationId)).status).toBe("local");
});

test("a newer event still applies after an older one", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const base = Date.now();

  await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      eventTimestampMs: base,
      organizationId,
      type: "INITIAL_PURCHASE",
    }),
  );

  const laterExpiration = await postWebhook(
    webhookBody({
      appUserId: admin.userId,
      eventTimestampMs: base + 60_000,
      organizationId,
      type: "EXPIRATION",
    }),
  );
  expect(await laterExpiration.json()).toEqual({
    received: true,
    outcome: "applied",
  });

  expect((await readBilling(organizationId)).status).toBe("disabled");
});

test("the webhook fails closed when the shared secret is not configured", async () => {
  const previous = process.env[AUTH_ENV_KEY];
  delete process.env[AUTH_ENV_KEY];
  try {
    const response = await postWebhook(
      webhookBody({
        appUserId: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
        type: "RENEWAL",
      }),
      "Bearer anything",
    );
    expect(response.status).toBe(503);
  } finally {
    process.env[AUTH_ENV_KEY] = previous;
  }
});

test("a Stripe-store grant defers end-to-end when the lookup fails", async () => {
  const user = createTestUser();
  const organizationId = await registerAndAuthenticate(user);
  const eventId = crypto.randomUUID();

  const failingFetch = (async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ) => new Response("{}", { status: 500 })) as typeof fetch;
  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    {
      app_user_id: user.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + THIRTY_DAYS_MS,
      id: eventId,
      product_id: "p",
      store: "STRIPE",
      original_transaction_id: "sub_defer",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: "INITIAL_PURCHASE",
    },
    new Date(),
    {
      stripe: {
        env: { STRIPE_SECRET_KEY: "sk", STRIPE_SYNC_SOLO_PRICE_ID: "p" },
        fetchImpl: failingFetch,
      },
    },
  );

  // An unreadable binding must defer without mutable attribution or claiming.
  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe subscription lookup failed for a Stripe-store event",
  });
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
});
