import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { UNCONFIGURED_SYNC_BILLING_TIER_REASON } from "../../billing/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

function nativeGrant(input: {
  readonly appUserId: string;
  readonly eventId: string;
  readonly organizationId: string;
  readonly productId: string;
  readonly store: string;
}) {
  const now = Date.now();
  return {
    app_user_id: input.appUserId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + 30 * 24 * 60 * 60 * 1_000,
    id: input.eventId,
    product_id: input.productId,
    purchased_at_ms: now,
    store: input.store,
    subscriber_attributes: { orgId: { value: input.organizationId } },
    type: "INITIAL_PURCHASE" as const,
  };
}

test("an unconfigured paid native product remains unclaimed for retry", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  const eventId = crypto.randomUUID();
  const event = nativeGrant({
    appUserId: admin.userId,
    eventId,
    organizationId,
    productId: "sync_future_tier_monthly",
    store: "APP_STORE",
  });

  const expected = {
    status: "retry" as const,
    reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON,
  };
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  expect(await runRevenueCatWebhookWorkflow(db, event)).toEqual(expected);
  expect(await runRevenueCatWebhookWorkflow(db, event)).toEqual(expected);
  errorSpy.mockRestore();
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
});

test("an unknown store cannot delete a retained Stripe binding", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await setTestOrganizationBillingLocal(organizationId);
  await db
    .delete(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_retained",
    subscriptionId: "sub_retained",
    subscriptionItemId: "si_retained",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeGrant({
      appUserId: admin.userId,
      eventId: crypto.randomUUID(),
      organizationId,
      productId: "sync_solo_monthly",
      store: "FUTURE_STORE",
    }),
  );
  expect(outcome).toMatchObject({ organizationId, status: "applied" });
  const [binding] = await db
    .select({ subscriptionId: organizationBillingStripeSeats.subscriptionId })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(binding?.subscriptionId).toBe("sub_retained");
});
