import { expect, spyOn, test } from "bun:test";
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

async function registerPersonalOrganization(): Promise<{
  readonly organizationId: string;
  readonly user: TestUser;
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

test("a stale lifecycle grant for a moved subscription is ignored", async () => {
  const alert = spyOn(console, "error").mockImplementation(() => undefined);
  const previous = await registerPersonalOrganization();
  const destination = await registerPersonalOrganization();
  const subscriptionId = `native-${crypto.randomUUID()}`;
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerSubscriptionId: subscriptionId,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, destination.organizationId));
  const now = Date.now();
  const event: RevenueCatWebhookEvent = {
    app_user_id: previous.user.userId,
    entitlement_ids: ["sync"],
    event_timestamp_ms: now,
    expiration_at_ms: now + 60_000,
    id: crypto.randomUUID(),
    original_transaction_id: subscriptionId,
    product_id: "com.tearleads.sync.monthly",
    purchased_at_ms: now,
    store: "APP_STORE",
    subscriber_attributes: {
      orgId: { value: previous.organizationId },
    },
    type: "INITIAL_PURCHASE",
  };

  expect(await runRevenueCatWebhookWorkflow(db, event, new Date(now))).toEqual({
    reason: "Native purchases may only fund the buyer's personal organization",
    status: "ignored",
  });
  const [audit] = await db
    .select({ outcome: revenuecatWebhookEvents.outcome })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, event.id));
  expect(audit?.outcome).toBe("ignored");
  expect(await runRevenueCatWebhookWorkflow(db, event, new Date(now))).toEqual({
    status: "duplicate",
  });
  expect(alert).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
