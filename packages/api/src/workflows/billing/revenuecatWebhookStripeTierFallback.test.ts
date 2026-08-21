import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

test("a rotated Stripe price renews at its locked fixed-tier capacity", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const subscriptionId = `sub_rotated_${organizationId}`;
  const subscriptionItemId = `si_rotated_${organizationId}`;
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: admin.userId,
      providerProductId: "price_rotated",
      providerSubscriptionId: subscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_rotated",
    subscriptionId,
    subscriptionItemId,
  });
  const eventId = crypto.randomUUID();
  const expirationAtMs = Date.now() + 30 * 24 * 60 * 60 * 1_000;
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: Date.now(),
    expiration_at_ms: expirationAtMs,
    id: eventId,
    original_transaction_id: subscriptionId,
    product_id: "prod_sync",
    store: "STRIPE",
    type: "RENEWAL",
  });

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
  expect(errorSpy).toHaveBeenCalledWith(
    `RevenueCat paid grant ${eventId} requires attention: Stripe subscription tier could not be resolved; preserving the locked billing tier`,
  );
  const [billing] = await db
    .select({
      currentPeriodEndsAt: organizationBilling.currentPeriodEndsAt,
      providerProductId: organizationBilling.providerProductId,
      seatCount: organizationBilling.seatCount,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    currentPeriodEndsAt: new Date(expirationAtMs),
    providerProductId: "price_rotated",
    seatCount: 5,
  });
  errorSpy.mockRestore();
});
