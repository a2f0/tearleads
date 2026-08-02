import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import {
  APP_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
  UNCONFIGURED_SYNC_BILLING_TIER_REASON,
} from "../../billing/revenuecatWebhook";
import { runGetOrganizationBillingWorkflow } from "./organizationBilling";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const PRODUCT_CHANGE: RevenueCatWebhookEvent = {
  app_user_id: "buyer",
  event_timestamp_ms: 1,
  id: "product-change",
  new_product_id: "sync_team_5_monthly",
  original_transaction_id: "native-subscription",
  product_id: "sync_solo_monthly",
  store: "PLAY_STORE",
  type: "PRODUCT_CHANGE",
};
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

test("an old-product renewal preserves a scheduled native downgrade", async () => {
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

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_solo_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_team_10_monthly",
    seatCount: 10,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBe(1);

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      type: "SUBSCRIPTION_EXTENDED",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBe(1);

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 3,
      expiration_at_ms: now + 2 * PERIOD_MS,
      id: crypto.randomUUID(),
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
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
      product_id: "sync_solo_monthly",
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_solo_monthly",
    seatCount: 1,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("a paused subscription clears its scheduled native change", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "paused_deferred_change",
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
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      new_product_id: "sync_solo_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      type: "SUBSCRIPTION_PAUSED",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 3,
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

test("a Stripe product change is acknowledged as provider-managed", async () => {
  const change: RevenueCatWebhookEvent = {
    ...PRODUCT_CHANGE,
    app_user_id: "cus_stripe_buyer",
    id: crypto.randomUUID(),
    new_product_id: "price_team_5",
    original_transaction_id: "sub_stripe_subscription",
    product_id: "price_solo",
    store: "STRIPE",
  };

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, change)).toEqual({
      reason: NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
      status: "ignored",
    });
    expect(await runRevenueCatWebhookWorkflow(db, change)).toEqual({
      status: "duplicate",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});

test("an unknown product change is acknowledged with an operator alert", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    ...PRODUCT_CHANGE,
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    new_product_id: null,
    original_transaction_id: "unknown_product_change",
    purchased_at_ms: now,
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    organizationId,
    status: "applied",
  });
  const change = {
    ...initial,
    event_timestamp_ms: now + 1,
    id: crypto.randomUUID(),
    new_product_id: "sync_unknown_monthly",
    type: "PRODUCT_CHANGE" as const,
  };
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    expect(await runRevenueCatWebhookWorkflow(db, change)).toEqual({
      reason: UNCONFIGURED_SYNC_BILLING_TIER_REASON,
      status: "ignored",
    });
    expect(await runRevenueCatWebhookWorkflow(db, change)).toEqual({
      status: "duplicate",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${change.id} was not applied: ${UNCONFIGURED_SYNC_BILLING_TIER_REASON}`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a Play upgrade settles from its effective purchase event", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "native_immediate_upgrade",
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

  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      await runRevenueCatWebhookWorkflow(db, {
        ...initial,
        event_timestamp_ms: now + 2,
        id: crypto.randomUUID(),
        new_product_id: null,
        original_transaction_id: "replacement_play_token",
        type: "PRODUCT_CHANGE",
      }),
    ).toEqual({
      reason: PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
      status: "ignored",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_solo_monthly",
    seatCount: 1,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      // RevenueCat does not guarantee that this effective purchase has a
      // later timestamp than its informational PRODUCT_CHANGE.
      event_timestamp_ms: now + 1,
      id: crypto.randomUUID(),
      original_transaction_id: "replacement_play_token",
      product_id: "sync_team_5_monthly",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_team_5_monthly",
    seatCount: 5,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
});

test("an Apple upgrade is not blocked by its newer schedule marker", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "apple_upgrade",
    product_id: "sync_solo_monthly",
    purchased_at_ms: now,
    store: "APP_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
    status: "applied",
  });
  const missingDestination = {
    ...initial,
    event_timestamp_ms: now + 1,
    id: crypto.randomUUID(),
    new_product_id: null,
    type: "PRODUCT_CHANGE" as const,
  };
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await runRevenueCatWebhookWorkflow(db, missingDestination)).toEqual({
      reason: APP_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
      status: "ignored",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${missingDestination.id} was not applied: ${APP_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON}`,
    );
  } finally {
    errorSpy.mockRestore();
  }
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 3,
      id: crypto.randomUUID(),
      new_product_id: "sync_team_5_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      product_id: "sync_team_5_monthly",
      type: "RENEWAL",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_team_5_monthly",
    seatCount: 5,
  });
});

test("expiration and a new purchase clear an old scheduled change", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const now = Date.now();
  const initial: RevenueCatWebhookEvent = {
    app_user_id: admin.userId,
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    original_transaction_id: "expired_subscription",
    product_id: "sync_team_10_monthly",
    purchased_at_ms: now,
    store: "PLAY_STORE",
    subscriber_attributes: { orgId: { value: organizationId } },
    type: "INITIAL_PURCHASE",
  };
  expect(await runRevenueCatWebhookWorkflow(db, initial)).toMatchObject({
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
  ).toMatchObject({ status: "applied" });

  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      type: "EXPIRATION",
    }),
  ).toMatchObject({ status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 3,
      id: crypto.randomUUID(),
      product_id: "sync_team_5_monthly",
    }),
  ).toMatchObject({ organizationId, status: "applied" });
  expect(await readTier(organizationId)).toEqual({
    providerProductId: "sync_team_5_monthly",
    seatCount: 5,
  });
  expect(
    (await runGetOrganizationBillingWorkflow(db, organizationId, admin.userId))
      .pendingSeatCount,
  ).toBeNull();
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
