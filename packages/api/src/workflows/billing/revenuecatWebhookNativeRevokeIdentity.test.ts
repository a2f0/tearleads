import { expect, spyOn, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const NATIVE_BINDING_CONFLICT_REASON =
  "Native event conflicts with an existing native subscription";
const MISSING_SUBSCRIPTION_REASON =
  "Native purchase is missing a subscription identifier";

test.each([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
] as const)("a tokenless native %s cannot create an incomplete binding", async (type) => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const event: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1_000,
    id: crypto.randomUUID(),
    product_id: "sync_solo_monthly",
    store: "APP_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type,
  };

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, event)).toEqual({
      reason: MISSING_SUBSCRIPTION_REASON,
      status: "retry",
    });
  } finally {
    errorSpy.mockRestore();
  }
  const [billing] = await db
    .select({
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toMatchObject({
    providerSubscriptionId: null,
    status: "trialing",
  });
  const [unclaimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(unclaimed).toBeUndefined();
});

test.each([
  ["wrong-token", "EXPIRATION"],
  ["tokenless", "EXPIRATION"],
  ["wrong-token", "SUBSCRIPTION_PAUSED"],
  ["tokenless", "SUBSCRIPTION_PAUSED"],
] as const)("a %s native %s cannot revoke the live subscription", async (identity, type) => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const subscriptionId = `live_${crypto.randomUUID()}`;
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + 30 * 24 * 60 * 60 * 1_000,
    id: crypto.randomUUID(),
    original_transaction_id: subscriptionId,
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
  const revoke: RevenueCatWebhookEvent = {
    ...initial,
    event_timestamp_ms: now + 1,
    id: crypto.randomUUID(),
    original_transaction_id:
      identity === "wrong-token" ? `wrong_${crypto.randomUUID()}` : undefined,
    type,
  };

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, revoke)).toEqual({
      reason: NATIVE_BINDING_CONFLICT_REASON,
      status: "retry",
    });
  } finally {
    errorSpy.mockRestore();
  }
  const [billing] = await db
    .select({
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing).toEqual({
    providerSubscriptionId: subscriptionId,
    status: "active",
  });
  const [unclaimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, revoke.id));
  expect(unclaimed).toBeUndefined();
});
