import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { runGetOrganizationBillingWorkflow } from "./organizationBilling";
import { PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON } from "./revenuecatGrantCapacity";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;

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
