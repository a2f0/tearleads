import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { DEFERRED_NATIVE_DOWNGRADE_REASON } from "./revenuecatGrantCapacity";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;

async function readTier(organizationId: string) {
  const [billing] = await db
    .select({
      providerProductId: organizationBilling.providerProductId,
      seatCount: organizationBilling.seatCount,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected billing row");
  return billing;
}

test("a native downgrade keeps paid capacity until its renewal", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "native_deferred_downgrade",
    product_id: "sync_team_10_monthly",
    purchased_at_ms: now,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_solo_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toEqual({ status: "ignored", reason: DEFERRED_NATIVE_DOWNGRADE_REASON });
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_team_10_monthly",
    seatCount: 10,
  });

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + PERIOD_MS,
      expiration_at_ms: now + 2 * PERIOD_MS,
      id: crypto.randomUUID(),
      product_id: "sync_solo_monthly",
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_solo_monthly",
    seatCount: 1,
  });
});

test("a promotional product-less renewal reuses its bound product", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "promotional_renewal",
    product_id: "sync_team_5_monthly",
    purchased_at_ms: now,
    store: "PROMOTIONAL",
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
      event_timestamp_ms: now + PERIOD_MS,
      expiration_at_ms: now + 2 * PERIOD_MS,
      id: crypto.randomUUID(),
      product_id: null,
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "promotional:sync_team_5_monthly",
    seatCount: 1,
  });
});
