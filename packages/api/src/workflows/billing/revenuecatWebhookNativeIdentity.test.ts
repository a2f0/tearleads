import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runNativePurchaseEligibilityWorkflow } from "./nativePurchaseEligibility";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const NATIVE_BINDING_CONFLICT_REASON =
  "Native event conflicts with an existing native subscription";

function nativeEvent(input: {
  readonly appUserId: string;
  readonly eventTimestamp: number;
  readonly organizationId: string;
  readonly productId?: string;
  readonly subscriptionId: string;
  readonly type?: RevenueCatWebhookEvent["type"];
}): RevenueCatWebhookEvent {
  return {
    app_user_id: input.appUserId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: input.eventTimestamp,
    expiration_at_ms: input.eventTimestamp + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: input.subscriptionId,
    product_id: input.productId ?? "sync_solo_monthly",
    purchased_at_ms: input.eventTimestamp,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: input.organizationId } },
    type: input.type ?? "INITIAL_PURCHASE",
  };
}

test("native preflight rejects a second subscription on another store", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const event = {
    ...nativeEvent({
      appUserId: admin.userId,
      eventTimestamp: Date.now(),
      organizationId,
      subscriptionId: "apple_subscription",
    }),
    store: "APP_STORE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, event)).toMatchObject({
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
    await runNativePurchaseEligibilityWorkflow(
      db,
      organizationId,
      admin.userId,
      "play_store",
    ),
  ).toEqual({
    eligible: false,
    reason: "existing_subscription_conflict",
  });
});

test("a second native purchase cannot replace a live binding", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  expect(
    await runRevenueCatWebhookWorkflow(
      db,
      nativeEvent({
        appUserId: admin.userId,
        eventTimestamp: now,
        organizationId,
        subscriptionId: "first_subscription",
      }),
    ),
  ).toMatchObject({ status: "applied" });
  const conflicting = nativeEvent({
    appUserId: admin.userId,
    eventTimestamp: now + 1,
    organizationId,
    productId: "sync_team_5_monthly",
    subscriptionId: "second_subscription",
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, conflicting)).toEqual({
      reason: NATIVE_BINDING_CONFLICT_REASON,
      status: "retry",
    });
  } finally {
    errorSpy.mockRestore();
  }
  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerProductId: "sync_solo_monthly",
    providerSubscriptionId: "first_subscription",
  });
  const [unclaimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, conflicting.id));
  expect(unclaimed).toBeUndefined();
});

test("a Play replacement-token renewal follows an accepted product change", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initialToken = `initial_${crypto.randomUUID()}`;
  const replacementToken = `replacement_${crypto.randomUUID()}`;
  const initial = nativeEvent({
    appUserId: admin.userId,
    eventTimestamp: now,
    organizationId,
    subscriptionId: initialToken,
  });
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    status: "applied",
  });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_team_5_monthly",
      original_transaction_id: replacementToken,
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ status: "applied" });
  await db.insert(organizationBillingStripeSeats).values({
    organizationId,
    priceId: "price_retained",
    subscriptionId: "sub_replacement_retained",
    subscriptionItemId: "si_replacement_retained",
  });

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await runRevenueCatWebhookWorkflow(db, {
        ...initial,
        event_timestamp_ms: now + 2,
        id: crypto.randomUUID(),
        original_transaction_id: replacementToken,
        product_id: "sync_team_5_monthly",
        type: "RENEWAL",
      }),
    ).toMatchObject({ organizationId, status: "applied" });
  } finally {
    errorSpy.mockRestore();
  }
  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerProductId: "sync_team_5_monthly",
    providerSubscriptionId: replacementToken,
  });
  const [binding] = await db
    .select({
      priceId: organizationBillingStripeSeats.priceId,
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(binding).toEqual({
    priceId: null,
    subscriptionId: "sub_replacement_retained",
  });
});
