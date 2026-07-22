import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { runRevenueCatWebhookWorkflow } from "./revenuecatWebhook";

async function createActiveBilling(): Promise<string> {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationBilling).values({
    organizationId,
    status: "active",
  });
  return organizationId;
}

async function readBillingStatus(organizationId: string): Promise<string> {
  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  return billing?.status ?? "missing";
}

test("a Stripe si_ event uses its durable binding, not mutable orgId", async () => {
  const boundOrganizationId = await createActiveBilling();
  const mutableOrganizationId = await createActiveBilling();
  await db.insert(organizationBillingStripeSeats).values({
    organizationId: boundOrganizationId,
    subscriptionId: "sub_bound",
    subscriptionItemId: "si_bound",
  });

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    id: crypto.randomUUID(),
    original_transaction_id: "si_bound",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: mutableOrganizationId },
    },
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    billingStatus: "disabled",
    organizationId: boundOrganizationId,
    status: "applied",
  });
  expect(await readBillingStatus(boundOrganizationId)).toBe("disabled");
  expect(await readBillingStatus(mutableOrganizationId)).toBe("active");
});

test("an unresolved Stripe si_ event never uses mutable orgId", async () => {
  const mutableOrganizationId = await createActiveBilling();
  const eventId = crypto.randomUUID();

  const outcome = await runRevenueCatWebhookWorkflow(db, {
    app_user_id: crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    id: eventId,
    original_transaction_id: "si_unresolved",
    store: "STRIPE",
    subscriber_attributes: {
      orgId: { value: mutableOrganizationId },
    },
    type: "EXPIRATION",
  });

  expect(outcome).toEqual({
    status: "retry",
    reason: "Stripe subscription lookup failed for a Stripe-store event",
  });
  expect(await readBillingStatus(mutableOrganizationId)).toBe("active");
  const [claimed] = await db
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(claimed).toBeUndefined();
});
