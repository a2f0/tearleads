import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runGetOrganizationBillingWorkflow } from "./organizationBilling";
import { PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON } from "./revenuecatGrantCapacity";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";
import { TERMINAL_ORGANIZATION_BILLING_REASON } from "./revenuecatWebhookPolicy";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;

async function createScheduledDowngrade(input?: {
  readonly purchasedAtMs: null;
}) {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: `scheduled_change_${crypto.randomUUID()}`,
    product_id: "sync_team_10_monthly",
    purchased_at_ms: input ? input.purchasedAtMs : now,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_solo_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  return { admin, initial, now, organizationId };
}

test("a product change from a different buyer creates no pending state", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const otherBuyer = createTestUser();
  await registerAndAuthenticate(otherBuyer);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "buyer_policy_subscription",
    product_id: "sync_solo_monthly",
    purchased_at_ms: now,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      app_user_id: otherBuyer.userId,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_team_5_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toEqual({
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
    status: "ignored",
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("a delayed store grant cannot reactivate a purged organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({ purgedAt: new Date(), status: "purged" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const now = Date.now();
  const event: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: `late_${crypto.randomUUID()}`,
    product_id: "sync_solo_monthly",
    purchased_at_ms: now,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };

  expect(await runRevenueCatWebhookWorkflow(db, event)).toEqual({
    reason: TERMINAL_ORGANIZATION_BILLING_REASON,
    status: "ignored",
  });
  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.status).toBe("purged");
});

test("a scheduled change expires when a new paid period keeps the old tier", async () => {
  const { admin, initial, now, organizationId } =
    await createScheduledDowngrade();
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBe(1);

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + PERIOD_MS,
      expiration_at_ms: now + 2 * PERIOD_MS,
      id: crypto.randomUUID(),
      purchased_at_ms: now + PERIOD_MS,
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("a native transfer resolves an older scheduled change", async () => {
  const { admin, now, organizationId } = await createScheduledDowngrade();
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: admin.userId,
    eventId: crypto.randomUUID(),
    eventTimestamp: new Date(now + 2),
    eventType: "TRANSFER",
    organizationId,
    originalTransactionId: "replacement_subscription",
    outcome: "applied",
    productId: "sync_team_5_monthly",
    transactionId: "replacement_subscription",
  });

  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("a second product change back to the current tier clears the schedule", async () => {
  const { admin, initial, now, organizationId } =
    await createScheduledDowngrade();
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      new_product_id: "sync_team_10_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ organizationId, status: "applied" });

  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("a renewal resolves a schedule with no known period start", async () => {
  const { admin, initial, now, organizationId } =
    await createScheduledDowngrade({ purchasedAtMs: null });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBe(1);

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      expiration_at_ms: now + 2 * PERIOD_MS,
      id: crypto.randomUUID(),
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});
