import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const STRIPE_CONFLICT_REASON =
  "Native entitlement is active while a retained Stripe subscription may still bill";
const SUPERSEDED_STRIPE_EVENT_REASON =
  "Stripe event does not own the current native entitlement";

for (const conflict of [
  { name: "active", status: "active", subscriptionId: "sub_live" },
  { name: "past-due", status: "past_due", subscriptionId: "sub_past_due" },
  { name: "trialing", status: "trialing", subscriptionId: "sub_trialing" },
  { name: "item-only", status: "active", subscriptionId: null },
] as const) {
  test(`a paid native grant takes ownership from a ${conflict.name} Stripe binding`, async () => {
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
      original_transaction_id: "native_transaction",
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
      status: "applied",
      organizationId,
      billingStatus: "active",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} requires attention: ${STRIPE_CONFLICT_REASON}`,
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
      providerProductId: "sync_team_10_monthly",
      status: "active",
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
      priceId: null,
      subscriptionId: conflict.subscriptionId,
      subscriptionItemId,
    });

    if (conflict.name === "active") {
      const renewalId = crypto.randomUUID();
      const renewalErrorSpy = spyOn(console, "error").mockImplementation(
        () => undefined,
      );
      expect(
        await runRevenueCatWebhookWorkflow(db, {
          app_user_id: admin.userId,
          entitlement_ids: ["sync"],
          event_timestamp_ms: event.event_timestamp_ms + 1,
          expiration_at_ms:
            event.event_timestamp_ms + 31 * 24 * 60 * 60 * 1_000,
          id: renewalId,
          original_transaction_id: "sub_live",
          product_id: "prod_sync",
          store: "STRIPE",
          type: "RENEWAL",
        }),
      ).toEqual({
        status: "ignored",
        reason: SUPERSEDED_STRIPE_EVENT_REASON,
      });
      expect(renewalErrorSpy).toHaveBeenCalledWith(
        `RevenueCat paid grant ${renewalId} was not applied: ${SUPERSEDED_STRIPE_EVENT_REASON}`,
      );
      renewalErrorSpy.mockRestore();
      const [bindingAfterRenewal] = await db
        .select({ id: organizationBillingStripeSeats.id })
        .from(organizationBillingStripeSeats)
        .where(
          eq(organizationBillingStripeSeats.organizationId, organizationId),
        );
      expect(bindingAfterRenewal).toBeDefined();

      expect(
        await runRevenueCatWebhookWorkflow(db, {
          app_user_id: admin.userId,
          event_timestamp_ms: event.event_timestamp_ms + 2,
          id: crypto.randomUUID(),
          original_transaction_id: "sub_live",
          store: "STRIPE",
          type: "EXPIRATION",
        }),
      ).toEqual({
        status: "ignored",
        reason: SUPERSEDED_STRIPE_EVENT_REASON,
      });
      const [afterExpiration] = await db
        .select({ id: organizationBillingStripeSeats.id })
        .from(organizationBillingStripeSeats)
        .where(
          eq(organizationBillingStripeSeats.organizationId, organizationId),
        );
      expect(afterExpiration).toBeUndefined();
      const [nativeBilling] = await db
        .select({
          providerProductId: organizationBilling.providerProductId,
          status: organizationBilling.status,
        })
        .from(organizationBilling)
        .where(eq(organizationBilling.organizationId, organizationId));
      expect(nativeBilling).toEqual({
        providerProductId: "sync_team_10_monthly",
        status: "active",
      });
    }
  });
}

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
      product_id: "sync_monthly",
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
