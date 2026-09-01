import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { runClaimNativeSubscriptionWorkflow } from "./nativeSubscriptionClaim";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

test("claims native billing after an applied Stripe expiration", async () => {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  const { organizationId } = registered;
  const subscriptionId = `sub_expired_${crypto.randomUUID()}`;
  const subscriptionItemId = `si_expired_${crypto.randomUUID()}`;
  const now = Date.now();
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "price_team_5",
      providerSubscriptionId: subscriptionItemId,
      providerTransactionId: subscriptionId,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await db
    .update(organizationBillingStripeSeats)
    .set({
      priceId: "price_team_5",
      subscriptionId,
      subscriptionItemId,
    })
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      app_user_id: user.userId,
      event_timestamp_ms: now,
      id: crypto.randomUUID(),
      original_transaction_id: subscriptionId,
      store: "STRIPE",
      transaction_id: subscriptionItemId,
      type: "EXPIRATION",
    }),
  ).toMatchObject({ billingStatus: "disabled", status: "applied" });

  const nativeSubscription = {
    currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
    currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
    productId: "sync_team_5_monthly:monthly",
    store: "play_store" as const,
    subscriptionId: `GPA.${crypto.randomUUID()}`,
  };
  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: user.userId,
      db,
      organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: nativeSubscription,
    }),
  ).resolves.toEqual({ duplicate: false, sourceOrganizationId: null });
  const [billing] = await db
    .select({
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerSubscriptionId: nativeSubscription.subscriptionId,
    status: "active",
  });
  const [stripeBinding] = await db
    .select({ organizationId: organizationBillingStripeSeats.organizationId })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(stripeBinding).toBeUndefined();
});
