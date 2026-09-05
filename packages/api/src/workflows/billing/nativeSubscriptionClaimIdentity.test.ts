import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerUser } from "../../../test/helpers/registerUser";
import { runClaimNativeSubscriptionWorkflow } from "./nativeSubscriptionClaim";

test("an exact-token claim cannot supply missing durable native-store identity", async () => {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  if (!registered) throw new Error("Expected registered organization");
  const { organizationId } = registered;
  const subscriptionId = `GPA.${crypto.randomUUID()}`;
  const eventId = crypto.randomUUID();
  const productId = "sync_team_5_monthly:monthly";
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: productId,
      providerSubscriptionId: subscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  const billingBefore = await db
    .select()
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: user.userId,
      auditEvent: { eventId, eventTimestamp: new Date() },
      db,
      organizationId,
      requireSessionAccess: false,
      sourceId: eventId,
      subscription: {
        currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
        currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
        productId,
        store: "play_store",
        subscriptionId,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db
      .select()
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId)),
  ).toEqual(billingBefore);
  expect(
    await db
      .select()
      .from(revenuecatWebhookEvents)
      .where(eq(revenuecatWebhookEvents.eventId, eventId)),
  ).toEqual([]);
});
