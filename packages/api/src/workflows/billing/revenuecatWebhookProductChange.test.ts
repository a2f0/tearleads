import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import {
  classifyRevenueCatEvent,
  NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  PLAY_PRODUCT_CHANGE_WITHOUT_DESTINATION_REASON,
} from "../../billing/revenuecatWebhook";
import { runGetOrganizationBillingWorkflow } from "./organizationBilling";
import {
  PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  resolveBoundRevenueCatTransition,
} from "./revenuecatGrantCapacity";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";
import { logUnappliedRevenueCatPaidEvent } from "./revenuecatWebhookLogging";

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
const BOUND_SOLO_BILLING: LockedBillingIdentity = {
  provider: "revenuecat",
  providerCustomerId: "buyer",
  providerProductId: "sync_solo_monthly",
  providerSubscriptionId: "native-subscription",
  seatCount: 1,
  status: "active",
};

function resolveProductChange(input: {
  billing?: LockedBillingIdentity;
  event?: RevenueCatWebhookEvent;
}) {
  const event = input.event ?? PRODUCT_CHANGE;
  return resolveBoundRevenueCatTransition({
    allowSandboxEvents: true,
    billing: input.billing ?? BOUND_SOLO_BILLING,
    event,
    now: new Date(1),
    transition: classifyRevenueCatEvent(event, new Date(1), {
      allowSandboxEvents: true,
    }),
  });
}

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

test("a product change rejects a different RevenueCat buyer", () => {
  expect(
    resolveProductChange({
      event: { ...PRODUCT_CHANGE, app_user_id: "different-buyer" },
    }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change rejects a mismatched bound seat capacity", () => {
  expect(
    resolveProductChange({ billing: { ...BOUND_SOLO_BILLING, seatCount: 5 } }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a product change rejects a non-native store", () => {
  expect(
    resolveProductChange({ event: { ...PRODUCT_CHANGE, store: "STRIPE" } }),
  ).toEqual({
    kind: "ignore",
    reason: NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON,
  });
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
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${change.id} was not applied: ${NON_NATIVE_REVENUECAT_PRODUCT_CHANGE_REASON}`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("a product change accepts a replacement Play purchase token", () => {
  expect(
    resolveProductChange({
      event: {
        ...PRODUCT_CHANGE,
        original_transaction_id: "replacement-purchase-token",
      },
    }),
  ).toEqual({ kind: "schedule", fields: { status: "active" } });
});

test("a product change rejects a mismatched source tier", () => {
  expect(
    resolveProductChange({
      event: {
        ...PRODUCT_CHANGE,
        product_id: "sync_team_10_monthly",
      },
    }),
  ).toEqual({
    kind: "ignore",
    reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
  });
});

test("a rejected product change alerts the operator", () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    logUnappliedRevenueCatPaidEvent(PRODUCT_CHANGE, {
      status: "ignored",
      reason: PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${PRODUCT_CHANGE.id} was not applied: ${PRODUCT_CHANGE_BOUND_SUBSCRIPTION_MISMATCH_REASON}`,
    );
  } finally {
    errorSpy.mockRestore();
  }
});

test("an unknown product change retries without consuming its event id", async () => {
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
    expect(await runRevenueCatWebhookWorkflow(db, change)).toMatchObject({
      status: "retry",
    });
    expect(await runRevenueCatWebhookWorkflow(db, change)).toMatchObject({
      status: "retry",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `RevenueCat paid product change ${change.id} was not applied: Event product is not a configured sync billing tier`,
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
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 2,
      id: crypto.randomUUID(),
      new_product_id: "sync_team_5_monthly",
      type: "PRODUCT_CHANGE",
    }),
  ).toMatchObject({ status: "applied" });
  expect(
    await runRevenueCatWebhookWorkflow(db, {
      ...initial,
      event_timestamp_ms: now + 1,
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
