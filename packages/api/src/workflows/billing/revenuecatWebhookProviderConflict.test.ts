import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runNativePurchaseEligibilityWorkflow } from "./nativePurchaseEligibility";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const STRIPE_CONFLICT_REASON =
  "Native entitlement is active while a retained Stripe subscription may still bill";
for (const conflict of [
  { name: "active", status: "active", subscriptionId: "sub_live" },
  { name: "past-due", status: "past_due", subscriptionId: "sub_past_due" },
  { name: "trialing", status: "trialing", subscriptionId: "sub_trialing" },
  { name: "item-only", status: "active", subscriptionId: null },
] as const) {
  test(`a legacy native purchase retries behind a ${conflict.name} Stripe binding`, async () => {
    const admin = createTestUser();
    const organizationId = await registerAndAuthenticate(admin);
    const subscriptionItemId = `si_${conflict.name.replace("-", "_")}`;
    await db
      .update(organizationBilling)
      .set({
        providerCustomerId: admin.userId,
        providerProductId: "price_team_5",
        providerSubscriptionId: subscriptionItemId,
        status: conflict.status,
      })
      .where(eq(organizationBilling.organizationId, organizationId));
    await db
      .delete(organizationBillingStripeSeats)
      .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
    await db.insert(organizationBillingStripeSeats).values({
      organizationId,
      priceId: "price_team_5",
      subscriptionId: conflict.subscriptionId,
      subscriptionItemId,
    });
    const eventId = crypto.randomUUID();
    const event: RevenueCatWebhookEvent = {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
      id: eventId,
      original_transaction_id: `native_transaction_${conflict.name}`,
      product_id: "sync_team_10_monthly",
      store: "APP_STORE",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: "INITIAL_PURCHASE",
    };

    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    const outcome = await runRevenueCatWebhookWorkflow(db, event);

    expect(outcome).toEqual({
      status: "retry",
      reason: STRIPE_CONFLICT_REASON,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} was not applied: ${STRIPE_CONFLICT_REASON}`,
    );
    errorSpy.mockRestore();
    const [billing] = await db
      .select({
        providerProductId: organizationBilling.providerProductId,
        status: organizationBilling.status,
      })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId));
    expect(billing).toEqual({
      providerProductId: "price_team_5",
      status: conflict.status,
    });
    const [retainedBinding] = await db
      .select({
        priceId: organizationBillingStripeSeats.priceId,
        subscriptionId: organizationBillingStripeSeats.subscriptionId,
        subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
      })
      .from(organizationBillingStripeSeats)
      .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
    expect(retainedBinding).toEqual({
      priceId: "price_team_5",
      subscriptionId: conflict.subscriptionId,
      subscriptionItemId,
    });
    const [claimed] = await db
      .select({ id: revenuecatWebhookEvents.id })
      .from(revenuecatWebhookEvents)
      .where(eq(revenuecatWebhookEvents.eventId, eventId));
    expect(claimed).toBeUndefined();
  });
}

test("an applied Stripe expiration releases native purchase and webhook guards", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const subscriptionId = `sub_expired_${crypto.randomUUID()}`;
  const subscriptionItemId = `si_expired_${crypto.randomUUID()}`;
  const now = Date.now();
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: admin.userId,
      providerProductId: "price_team_5",
      providerSubscriptionId: subscriptionItemId,
      providerTransactionId: subscriptionId,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_team_5",
    subscriptionId,
    subscriptionItemId,
  });

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      app_user_id: admin.userId,
      event_timestamp_ms: now,
      id: crypto.randomUUID(),
      original_transaction_id: subscriptionId,
      store: "STRIPE",
      transaction_id: subscriptionItemId,
      type: "EXPIRATION",
    }),
  ).toMatchObject({
    billingStatus: "disabled",
    organizationId,
    status: "applied",
  });
  expect(
    await runNativePurchaseEligibilityWorkflow(
      db,
      organizationId,
      admin.userId,
      "app_store",
    ),
  ).toEqual({ eligible: true, reason: null });

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: now + 1,
      expiration_at_ms: now + 30 * 24 * 60 * 60 * 1_000,
      id: crypto.randomUUID(),
      original_transaction_id: `native_${crypto.randomUUID()}`,
      product_id: "sync_solo_monthly",
      store: "APP_STORE",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: "INITIAL_PURCHASE",
    }),
  ).toMatchObject({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
  const [retainedBinding] = await db
    .select({ organizationId: organizationBillingStripeSeats.organizationId })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(retainedBinding).toBeUndefined();
});

for (const eventType of ["INITIAL_PURCHASE", "RENEWAL"] as const) {
  test(`a native ${eventType.toLowerCase()} retries behind a locked Stripe identity without its seat row`, async () => {
    const admin = createTestUser();
    const organizationId = await registerAndAuthenticate(admin);
    const providerSubscriptionId = `sub_missing_binding_${eventType.toLowerCase()}`;
    await db
      .update(organizationBilling)
      .set({
        provider: "revenuecat",
        providerCustomerId: admin.userId,
        providerProductId: "price_team_5",
        providerSubscriptionId,
        providerTransactionId: `si_missing_binding_${eventType.toLowerCase()}`,
        status: "active",
      })
      .where(eq(organizationBilling.organizationId, organizationId));
    await db
      .delete(organizationBillingStripeSeats)
      .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
    const eventId = crypto.randomUUID();
    const errorSpy = spyOn(console, "error").mockImplementation(
      () => undefined,
    );

    const outcome = await runRevenueCatWebhookWorkflow(db, {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
      id: eventId,
      original_transaction_id: "native_transaction",
      product_id: "sync_solo_monthly",
      store: "APP_STORE",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: eventType,
    });

    expect(outcome).toEqual({
      status: "retry",
      reason: STRIPE_CONFLICT_REASON,
    });
    errorSpy.mockRestore();
    const [billing] = await db
      .select({
        providerProductId: organizationBilling.providerProductId,
        providerSubscriptionId: organizationBilling.providerSubscriptionId,
      })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId));
    expect(billing).toEqual({
      providerProductId: "price_team_5",
      providerSubscriptionId,
    });
    const [claimed] = await db
      .select({ id: revenuecatWebhookEvents.id })
      .from(revenuecatWebhookEvents)
      .where(eq(revenuecatWebhookEvents.eventId, eventId));
    expect(claimed).toBeUndefined();
  });
}

test("an existing native renewal is not mistaken for a new purchase", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + 30 * 24 * 60 * 60 * 1_000,
    id: crypto.randomUUID(),
    original_transaction_id: "native_subscription",
    product_id: "sync_solo_monthly",
    purchased_at_ms: now,
    store: "APP_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_retained",
    subscriptionId: "sub_renewal_retained",
    subscriptionItemId: "si_renewal_retained",
  });
  const eventId = crypto.randomUUID();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: eventId,
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(errorSpy).toHaveBeenCalledWith(
    `RevenueCat paid grant ${eventId} requires attention: ${STRIPE_CONFLICT_REASON}`,
  );
  errorSpy.mockRestore();
  const [binding] = await db
    .select({
      priceId: organizationBillingStripeSeats.priceId,
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(binding).toEqual({
    priceId: null,
    subscriptionId: "sub_renewal_retained",
  });
});

test("a product-less lifecycle grant cannot invent an unbound tier", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const eventId = crypto.randomUUID();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    const outcome = await runRevenueCatWebhookWorkflow(db, {
      app_user_id: admin.userId,
      entitlement_ids: ["sync"],
      event_timestamp_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
      id: eventId,
      store: "APP_STORE",
      subscriber_attributes: { orgId: { value: organizationId } },
      type: "SUBSCRIPTION_EXTENDED",
    });

    expect(outcome).toEqual({
      status: "retry",
      reason: "Event product is not a configured sync billing tier",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} was not applied: Event product is not a configured sync billing tier`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a rejected RevenueCat Web Billing grant alerts the operator", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const eventId = crypto.randomUUID();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    const outcome = await runRevenueCatWebhookWorkflow(db, {
      app_user_id: admin.userId,
      event_timestamp_ms: Date.now(),
      id: eventId,
      metadata: { orgId: organizationId },
      product_id: "sync_solo_monthly",
      store: "RC_BILLING",
      type: "INITIAL_PURCHASE",
    });

    expect(outcome).toEqual({
      status: "ignored",
      reason: "RevenueCat Web Billing grants are not supported",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} was not applied: RevenueCat Web Billing grants are not supported`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});
