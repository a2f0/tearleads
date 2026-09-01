import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createOrganizationRequestBody } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";
import { runCreateOrganizationWorkflow } from "../organizations/createOrganization";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

async function registerBuyer(): Promise<{
  personalOrganizationId: string;
  user: TestUser;
}> {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ personalOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  return { personalOrganizationId: registered.personalOrganizationId, user };
}

async function createOrganization(user: TestUser): Promise<string> {
  const request = await createOrganizationRequestBody(user);
  const created = await runCreateOrganizationWorkflow(db, request);
  return created.organizationId;
}

async function bindSubscription(input: {
  buyerId: string;
  organizationId: string;
  productId?: string;
  status?: "active" | "disabled";
  store?: "APP_STORE" | "PLAY_STORE";
  subscriptionId: string;
}): Promise<void> {
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: input.buyerId,
      providerProductId: input.productId ?? "com.symcrypt.sync.monthly",
      providerSubscriptionId: input.subscriptionId,
      seatCount: 1,
      status: input.status ?? "active",
    })
    .where(eq(organizationBilling.organizationId, input.organizationId));
  await recordBindingStore({
    buyerId: input.buyerId,
    organizationId: input.organizationId,
    ...(input.productId ? { productId: input.productId } : {}),
    store: input.store ?? "APP_STORE",
    subscriptionId: input.subscriptionId,
  });
}

async function recordBindingStore(input: {
  buyerId: string;
  organizationId: string;
  productId?: string;
  store: "APP_STORE" | "PLAY_STORE";
  subscriptionId: string;
}): Promise<void> {
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: input.buyerId,
    eventId: crypto.randomUUID(),
    eventTimestamp: new Date(0),
    eventType: "INITIAL_PURCHASE",
    organizationId: input.organizationId,
    originalTransactionId: input.subscriptionId,
    outcome: "applied",
    productId: input.productId ?? "com.symcrypt.sync.monthly",
    store: input.store,
  });
}

function nativeEvent(input: {
  buyerId: string;
  newProductId?: string;
  organizationId: string;
  productId?: string;
  store: "APP_STORE" | "PLAY_STORE";
  subscriptionId?: string;
  type: "EXPIRATION" | "INITIAL_PURCHASE" | "PRODUCT_CHANGE" | "RENEWAL";
}): RevenueCatWebhookEvent {
  const now = Date.now();
  return {
    app_user_id: input.buyerId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    ...(input.newProductId ? { new_product_id: input.newProductId } : {}),
    ...(input.subscriptionId
      ? { original_transaction_id: input.subscriptionId }
      : {}),
    product_id: input.productId ?? "com.symcrypt.sync.monthly",
    purchased_at_ms: now,
    store: input.store,
    subscriber_attributes: { orgId: { value: input.organizationId } },
    type: input.type,
  };
}

async function readSubscriptionId(organizationId: string) {
  const [billing] = await db
    .select({ subscriptionId: organizationBilling.providerSubscriptionId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected organization billing");
  return billing.subscriptionId;
}

async function readProductId(organizationId: string) {
  const [billing] = await db
    .select({ productId: organizationBilling.providerProductId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected organization billing");
  return billing.productId;
}

test("a new native purchase cannot overwrite a restored organization binding", async () => {
  const { user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    subscriptionId: "restored-subscription",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: restoredOrganizationId,
      store: "APP_STORE",
      subscriptionId: "new-subscription",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(outcome).toEqual({
    reason: "Native purchases may only fund the buyer's personal organization",
    status: "ignored",
  });
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "restored-subscription",
  );
});

test("native lifecycle events route by subscription across two store bindings", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    subscriptionId: "apple-subscription",
  });
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    store: "PLAY_STORE",
    subscriptionId: "play-subscription",
  });

  const appleOutcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      // The mutable customer attribute points at the latest restored org.
      organizationId: restoredOrganizationId,
      store: "APP_STORE",
      subscriptionId: "apple-subscription",
      type: "RENEWAL",
    }),
  );
  const playOutcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: personalOrganizationId,
      store: "PLAY_STORE",
      subscriptionId: "play-subscription",
      type: "RENEWAL",
    }),
  );

  expect(appleOutcome).toMatchObject({
    organizationId: personalOrganizationId,
    status: "applied",
  });
  expect(playOutcome).toMatchObject({
    organizationId: restoredOrganizationId,
    status: "applied",
  });
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "apple-subscription",
  );
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "play-subscription",
  );

  const missingIdOutcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: restoredOrganizationId,
      store: "PLAY_STORE",
      type: "RENEWAL",
    }),
  );
  expect(missingIdOutcome).toEqual({
    reason: "Event carried no organization id",
    status: "ignored",
  });
});

test("a missing receipt id routes to the unique restored binding", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    subscriptionId: "restored-subscription-with-omitted-event-id",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      // The mutable customer attribute does not identify the restored binding.
      organizationId: personalOrganizationId,
      store: "APP_STORE",
      type: "RENEWAL",
    }),
  );
  expect(outcome).toMatchObject({
    organizationId: restoredOrganizationId,
    status: "applied",
  });
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "restored-subscription-with-omitted-event-id",
  );
});

test("a receipt-less lifecycle event fails closed across retained bindings", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const disabledOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: disabledOrganizationId,
    status: "disabled",
    subscriptionId: "disabled-retained-subscription",
  });
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    subscriptionId: "active-retained-subscription",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: personalOrganizationId,
      store: "APP_STORE",
      type: "RENEWAL",
    }),
  );

  expect(outcome).toEqual({
    reason: "Event carried no organization id",
    status: "ignored",
  });
  expect(await readSubscriptionId(disabledOrganizationId)).toBe(
    "disabled-retained-subscription",
  );
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "active-retained-subscription",
  );
});

test("a receipt-less initial purchase cannot overwrite a restored binding", async () => {
  const { user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    subscriptionId: "restored-subscription-before-receipt-less-purchase",
  });

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: restoredOrganizationId,
      store: "PLAY_STORE",
      type: "INITIAL_PURCHASE",
    }),
  );

  expect(outcome).toEqual({
    reason: "Native purchases may only fund the buyer's personal organization",
    status: "ignored",
  });
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "restored-subscription-before-receipt-less-purchase",
  );
});

test("unmatched native lifecycle receipts cannot use the mutable orgId", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    subscriptionId: "known-personal-subscription",
  });
  for (const type of ["RENEWAL", "EXPIRATION"] as const) {
    const outcome = await runRevenueCatWebhookWorkflow(
      db,
      nativeEvent({
        buyerId: user.userId,
        organizationId: personalOrganizationId,
        store: "APP_STORE",
        subscriptionId: `${type.toLowerCase()}-unknown-subscription`,
        type,
      }),
    );
    expect(outcome).toEqual({
      reason: "Native event conflicts with an existing native subscription",
      status: "retry",
    });
  }
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "known-personal-subscription",
  );
});

test("a replacement Play token fails closed across same-tier bindings", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    store: "PLAY_STORE",
    subscriptionId: "first-play-subscription",
  });
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    store: "PLAY_STORE",
    subscriptionId: "second-play-subscription",
  });

  const replacementEvent = nativeEvent({
    buyerId: user.userId,
    newProductId: "sync_team_5_monthly",
    organizationId: restoredOrganizationId,
    store: "PLAY_STORE",
    subscriptionId: "replacement-play-token",
    type: "PRODUCT_CHANGE",
  });
  const outcome = await runRevenueCatWebhookWorkflow(db, replacementEvent);

  expect(outcome).toEqual({
    reason: "Product change does not match a bound native subscription",
    status: "ignored",
  });
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "first-play-subscription",
  );
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "second-play-subscription",
  );

  const effectiveOutcome = await runRevenueCatWebhookWorkflow(db, {
    ...replacementEvent,
    id: crypto.randomUUID(),
    type: "INITIAL_PURCHASE",
  });
  expect(effectiveOutcome).toEqual({
    reason: "Native purchases may only fund the buyer's personal organization",
    status: "ignored",
  });
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    "second-play-subscription",
  );
});

test("a Play replacement token cannot select an App Store binding", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    subscriptionId: "app-store-source-subscription",
  });
  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      newProductId: "sync_team_5_monthly",
      organizationId: personalOrganizationId,
      store: "PLAY_STORE",
      subscriptionId: "unbound-play-replacement-token",
      type: "PRODUCT_CHANGE",
    }),
  );
  expect(outcome).toEqual({
    reason: "Product change does not match a bound native subscription",
    status: "ignored",
  });
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "app-store-source-subscription",
  );
});

test("an applied Play change routes its token despite a wrong orgId", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    productId: "sync_team_5_monthly",
    subscriptionId: "unrelated-team-subscription",
  });
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
    productId: "com.symcrypt.sync.monthly",
    store: "PLAY_STORE",
    subscriptionId: "restored-solo-subscription",
  });

  const replacementToken = "applied-replacement-play-token";
  const changeOutcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      newProductId: "sync_team_5_monthly",
      // The mutable customer attribute points at the unrelated organization.
      organizationId: personalOrganizationId,
      store: "PLAY_STORE",
      subscriptionId: replacementToken,
      type: "PRODUCT_CHANGE",
    }),
  );
  expect(changeOutcome).toMatchObject({
    organizationId: restoredOrganizationId,
    status: "applied",
  });

  const effectiveOutcome = await runRevenueCatWebhookWorkflow(
    db,
    nativeEvent({
      buyerId: user.userId,
      organizationId: personalOrganizationId,
      productId: "sync_team_5_monthly",
      store: "PLAY_STORE",
      subscriptionId: replacementToken,
      type: "INITIAL_PURCHASE",
    }),
  );
  expect(effectiveOutcome).toMatchObject({
    organizationId: restoredOrganizationId,
    status: "applied",
  });
  expect(await readSubscriptionId(restoredOrganizationId)).toBe(
    replacementToken,
  );
  expect(await readProductId(restoredOrganizationId)).toBe(
    "sync_team_5_monthly",
  );
  expect(await readSubscriptionId(personalOrganizationId)).toBe(
    "unrelated-team-subscription",
  );
});
