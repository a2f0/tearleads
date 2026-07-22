import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function registerOrganizationAdmin(): Promise<{
  organizationId: string;
  user: TestUser;
}> {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  return { organizationId: registered.organizationId, user };
}

function initialStripeEvent(input: {
  readonly appUserId: string;
  readonly eventId: string;
  readonly organizationId: string;
  readonly subscriptionItemId: string;
}): RevenueCatWebhookEvent {
  const now = Date.now();
  return {
    app_user_id: input.appUserId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + THIRTY_DAYS_MS,
    id: input.eventId,
    metadata: { orgId: input.organizationId },
    original_transaction_id: input.subscriptionItemId,
    purchased_at_ms: now,
    store: "STRIPE",
    subscriber_attributes: { orgId: { value: crypto.randomUUID() } },
    type: "INITIAL_PURCHASE",
  };
}

async function readBillingIdentity(organizationId: string) {
  const [billing] = await db
    .select({
      providerCustomerId: organizationBilling.providerCustomerId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected organization billing");
  return billing;
}

async function expectEventUnclaimed(eventId: string): Promise<void> {
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
}

test("an admin can finish an unbound pre-rollout Stripe purchase", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const event = initialStripeEvent({
    appUserId: user.userId,
    eventId: crypto.randomUUID(),
    organizationId,
    subscriptionItemId: "si_predeploy_admin",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, event);

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId,
    status: "applied",
  });
  expect(await readBillingIdentity(organizationId)).toMatchObject({
    providerCustomerId: user.userId,
    providerSubscriptionId: "si_predeploy_admin",
    status: "active",
  });
});

test("a non-admin cannot finish an unbound pre-rollout purchase", async () => {
  const { organizationId } = await registerOrganizationAdmin();
  const { user: nonAdmin } = await registerOrganizationAdmin();
  const event = initialStripeEvent({
    appUserId: nonAdmin.userId,
    eventId: crypto.randomUUID(),
    organizationId,
    subscriptionItemId: "si_predeploy_non_admin",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, event);

  expect(outcome).toEqual({
    status: "ignored",
    reason: "Buyer is not an organization admin",
  });
  expect(await readBillingIdentity(organizationId)).toMatchObject({
    providerCustomerId: null,
    providerSubscriptionId: null,
  });
});

test("an unbound metadata revoke remains a retry", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: user.userId,
    event_timestamp_ms: Date.now(),
    id: eventId,
    metadata: { orgId: organizationId },
    original_transaction_id: "si_predeploy_revoke",
    store: "STRIPE",
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe binding changed before RevenueCat event application",
  });
  await expectEventUnclaimed(eventId);
});

test("a partially bound identity cannot use the initial-grant exception", async () => {
  const { organizationId, user } = await registerOrganizationAdmin();
  await db
    .update(organizationBilling)
    .set({ providerSubscriptionId: "si_predeploy_partial" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(
    db,
    initialStripeEvent({
      appUserId: user.userId,
      eventId,
      organizationId,
      subscriptionItemId: "si_predeploy_partial",
    }),
  );

  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe binding changed before RevenueCat event application",
  });
  await expectEventUnclaimed(eventId);
  expect(await readBillingIdentity(organizationId)).toMatchObject({
    providerCustomerId: null,
    providerSubscriptionId: "si_predeploy_partial",
  });
});
