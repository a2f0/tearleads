import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import {
  addSyntheticEffectiveOrganizationMembers,
  registerAndAuthenticate,
} from "../../../test/helpers/revenuecatWebhook";
import { loadOrganizationBillingSeatUsage } from "./organizationSeatUsage";
import {
  type RevenueCatWebhookOutcome,
  runRevenueCatWebhookWorkflow,
} from "./revenuecatWebhook";

interface BillingIdentityInput {
  readonly providerCustomerId?: string;
  readonly providerSubscriptionId?: string;
}

async function createActiveBilling(
  input: BillingIdentityInput = {},
): Promise<string> {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationBilling).values({
    organizationId,
    ...input,
    status: "active",
  });
  return organizationId;
}

async function readBillingStatus(organizationId: string): Promise<string> {
  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  return billing?.status ?? "missing";
}

async function expectLockedRetry(
  outcome: RevenueCatWebhookOutcome,
  eventId: string,
): Promise<void> {
  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe binding changed before RevenueCat event application",
  });
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
}

test("a Stripe si_ event uses its durable binding, not mutable orgId", async () => {
  const boundOrganizationId = await createActiveBilling();
  const mutableOrganizationId = await createActiveBilling();
  await db.insert(organizationBillingStripeSeats).values({
    organizationId: boundOrganizationId,
    subscriptionId: "sub_bound",
    subscriptionItemId: "si_bound",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    original_transaction_id: "si_bound",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: mutableOrganizationId },
    },
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    billingStatus: "disabled",
    organizationId: boundOrganizationId,
    status: "applied",
  });
  expect(await readBillingStatus(boundOrganizationId)).toBe("disabled");
  expect(await readBillingStatus(mutableOrganizationId)).toBe("active");
});

test("exact provider lookup cannot override a newer outbox subscription", async () => {
  const appUserId = crypto.randomUUID();
  const organizationId = await createActiveBilling({
    providerCustomerId: appUserId,
    providerSubscriptionId: "sub_new_provider",
  });
  const eventId = crypto.randomUUID();
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    subscriptionId: "sub_new_provider",
    subscriptionItemId: "si_new_provider",
  });
  const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "sub_old_provider",
        items: {
          data: [
            {
              id: "si_old_provider",
              price: { id: "price_sync" },
              quantity: 1,
            },
          ],
        },
        metadata: { orgId: organizationId },
      }),
    )) as typeof fetch;

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    {
      app_user_id: appUserId,
      event_timestamp_ms: Date.now(),
      id: eventId,
      original_transaction_id: "sub_old_provider",
      store: "STRIPE",
      type: "EXPIRATION",
    },
    new Date(),
    {
      stripe: {
        env: {
          STRIPE_SECRET_KEY: "sk_test",
          STRIPE_SYNC_SOLO_PRICE_ID: "price_sync",
        },
        fetchImpl,
      },
    },
  );

  await expectLockedRetry(outcome, eventId);
  expect(await readBillingStatus(organizationId)).toBe("active");
});

test("unsafe Stripe si_ metadata never falls back to mutable orgId", async () => {
  const mutableOrganizationId = await createActiveBilling();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    id: eventId,
    metadata: { orgId: "not-a-uuid" },
    original_transaction_id: "si_unresolved",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: mutableOrganizationId },
    },
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe subscription lookup failed for a Stripe-store event",
  });
  expect(await readBillingStatus(mutableOrganizationId)).toBe("active");
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
});

test("an exact durable binding is authoritative over stale metadata", async () => {
  const boundOrganizationId = await createActiveBilling();
  const metadataOrganizationId = await createActiveBilling();
  const eventId = crypto.randomUUID();
  await db.insert(organizationBillingStripeSeats).values({
    organizationId: boundOrganizationId,
    subscriptionId: "sub_metadata_mismatch",
    subscriptionItemId: "si_metadata_mismatch",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    id: eventId,
    metadata: { orgId: metadataOrganizationId },
    original_transaction_id: "si_metadata_mismatch",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: boundOrganizationId },
    },
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    billingStatus: "disabled",
    organizationId: boundOrganizationId,
    status: "applied",
  });
  expect(await readBillingStatus(boundOrganizationId)).toBe("disabled");
  expect(await readBillingStatus(metadataOrganizationId)).toBe("active");
});

test("a promotional grant preserves a live Stripe seat binding", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const eventNow = new Date("2099-01-01T00:00:00.000Z");
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    nextAttemptAt: eventNow,
    organizationId,
    priceId: "price_team_5",
    subscriptionId: "sub_still_live",
    subscriptionItemId: "si_still_live",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: eventNow.getTime(),
      expiration_at_ms: eventNow.getTime() + 30 * 24 * 60 * 60 * 1_000,
      id: crypto.randomUUID(),
      product_id: "sync_team_5_monthly",
      store: "PROMOTIONAL",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: "INITIAL_PURCHASE",
    },
    eventNow,
  );

  expect(outcome).toMatchObject({ organizationId, status: "applied" });
  const [binding] = await db
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(binding).toEqual({
    subscriptionId: "sub_still_live",
    subscriptionItemId: "si_still_live",
  });
});

test("an si_-only event with metadata no longer binds an organization", async () => {
  const appUserId = crypto.randomUUID();
  const metadataOrganizationId = await createActiveBilling({
    providerCustomerId: appUserId,
    providerSubscriptionId: "si_no_longer_resolved",
  });
  const mutableOrganizationId = await createActiveBilling();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: appUserId,
    event_timestamp_ms: Date.now(),
    id: eventId,
    metadata: { orgId: metadataOrganizationId },
    original_transaction_id: "si_no_longer_resolved",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: mutableOrganizationId },
    },
    type: "EXPIRATION",
  });

  // Post-greenfield there is no metadata-only Stripe resolution: an event
  // whose only identifier is an si_ item must attribute through Stripe
  // itself, so this one stays an unclaimed retry (503) — never a silently
  // suppressed ignore — and mutates no billing row.
  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe subscription lookup failed for a Stripe-store event",
  });
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
  expect(await readBillingStatus(metadataOrganizationId)).toBe("active");
  expect(await readBillingStatus(mutableOrganizationId)).toBe("active");
});

test("a Stripe renewal applies while its asynchronous tier update lags the roster", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await addSyntheticEffectiveOrganizationMembers({
    actor: admin,
    count: 5,
    organizationId,
  });
  await db
    .update(organizationBilling)
    .set({
      providerCustomerId: admin.userId,
      providerProductId: "price_team_5",
      providerSubscriptionId: "sub_outgrown",
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({
      desiredPaidCapacity: 5,
      desiredRenewalQuantity: 5,
      priceId: "price_team_5",
      subscriptionId: "sub_outgrown",
      subscriptionItemId: "si_outgrown",
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const expirationAtMs = Date.now() + 30 * 24 * 60 * 60 * 1_000;

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: expirationAtMs,
      id: crypto.randomUUID(),
      original_transaction_id: "sub_outgrown",
      product_id: "prod_sync",
      store: "STRIPE",
      type: "RENEWAL",
    },
    new Date(),
    {
      stripe: {
        env: {
          STRIPE_SECRET_KEY: "sk_test",
          STRIPE_SYNC_TEAM_5_PRICE_ID: "price_team_5",
        },
      },
    },
  );

  expect(outcome).toMatchObject({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
  const [billing] = await db
    .select({ currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.currentPeriodEndsAt?.getTime()).toBe(expirationAtMs);
});

test("a new unknown Stripe price retries with an operator alert", async () => {
  const organizationId = await createActiveBilling();
  const eventId = crypto.randomUUID();
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_unknown",
    subscriptionId: "sub_unknown_price",
    subscriptionItemId: "si_unknown_price",
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    entitlement_ids: ["sync"],
    event_timestamp_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
    id: eventId,
    original_transaction_id: "sub_unknown_price",
    product_id: "prod_sync",
    store: "STRIPE",
    type: "RENEWAL",
  });

  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe subscription tier could not be resolved",
  });
  expect(errorSpy).toHaveBeenCalledWith(
    `RevenueCat paid grant ${eventId} was not applied: Stripe subscription tier could not be resolved`,
  );
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
  errorSpy.mockRestore();
});

test("an oversized Stripe grant renews while bounding assignments", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await addSyntheticEffectiveOrganizationMembers({
    actor: admin,
    count: 10,
    organizationId,
  });
  await db
    .update(organizationBilling)
    .set({
      providerCustomerId: admin.userId,
      providerProductId: "price_team_10",
      providerSubscriptionId: "sub_oversized",
      seatCount: 10,
      status: "trialing",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({
      priceId: "price_team_10",
      subscriptionId: "sub_oversized",
      subscriptionItemId: "si_oversized",
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  const eventId = crypto.randomUUID();

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
      id: eventId,
      original_transaction_id: "sub_oversized",
      product_id: "prod_sync",
      store: "STRIPE",
      type: "INITIAL_PURCHASE",
    },
    new Date(),
    {
      stripe: {
        env: {
          STRIPE_SECRET_KEY: "sk_test",
          STRIPE_SYNC_TEAM_10_PRICE_ID: "price_team_10",
        },
      },
    },
  );

  expect(outcome).toEqual({
    status: "applied",
    organizationId,
    billingStatus: "active",
  });
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeDefined();
  expect(await readBillingStatus(organizationId)).toBe("active");
  expect(
    await loadOrganizationBillingSeatUsage({
      executor: db,
      organizationId,
      sessionUserId: admin.userId,
    }),
  ).toMatchObject({
    assignedSeatCount: 10,
    currentUserHasSyncSeat: true,
  });
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
