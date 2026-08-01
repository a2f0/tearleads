import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

test("a native grant cannot replace a live Stripe subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({
      providerCustomerId: admin.userId,
      providerProductId: "price_team_5",
      providerSubscriptionId: "si_live_native_race",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_team_5",
    subscriptionId: "sub_live_native_race",
    subscriptionItemId: "si_live_native_race",
  });
  const eventId = crypto.randomUUID();
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    const outcome = await runRevenueCatWebhookWorkflow(db, {
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
    });

    expect(outcome).toEqual({
      status: "ignored",
      reason:
        "A live Stripe subscription must lapse before a native purchase can be applied",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid grant ${eventId} was not applied: A live Stripe subscription must lapse before a native purchase can be applied`,
    );
  } finally {
    errorSpy.mockRestore();
  }

  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerProductId: "price_team_5",
    status: "active",
  });
  const [binding] = await db
    .select({ subscriptionId: organizationBillingStripeSeats.subscriptionId })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(binding?.subscriptionId).toBe("sub_live_native_race");
});
