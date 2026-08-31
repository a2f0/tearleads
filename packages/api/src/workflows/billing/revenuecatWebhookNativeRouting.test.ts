import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
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
  subscriptionId: string;
}): Promise<void> {
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: input.buyerId,
      providerProductId: "com.symcrypt.sync.monthly",
      providerSubscriptionId: input.subscriptionId,
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, input.organizationId));
}

function nativeEvent(input: {
  buyerId: string;
  newProductId?: string;
  organizationId: string;
  store: "APP_STORE" | "PLAY_STORE";
  subscriptionId: string;
  type: "INITIAL_PURCHASE" | "PRODUCT_CHANGE" | "RENEWAL";
}): RevenueCatWebhookEvent {
  const now = Date.now();
  return {
    app_user_id: input.buyerId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + PERIOD_MS,
    id: crypto.randomUUID(),
    ...(input.newProductId ? { new_product_id: input.newProductId } : {}),
    original_transaction_id: input.subscriptionId,
    product_id: "com.symcrypt.sync.monthly",
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
});

test("a replacement Play token fails closed across same-tier bindings", async () => {
  const { personalOrganizationId, user } = await registerBuyer();
  const restoredOrganizationId = await createOrganization(user);
  await bindSubscription({
    buyerId: user.userId,
    organizationId: personalOrganizationId,
    subscriptionId: "first-play-subscription",
  });
  await bindSubscription({
    buyerId: user.userId,
    organizationId: restoredOrganizationId,
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
