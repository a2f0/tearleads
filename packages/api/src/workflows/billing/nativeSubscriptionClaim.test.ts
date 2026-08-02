import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerUser } from "../../../test/helpers/registerUser";
import { OrganizationManagerError } from "../organizations/errors";
import { runClaimNativeSubscriptionWorkflow } from "./nativeSubscriptionClaim";
import { runGetOrganizationBillingHistoryWorkflow } from "./organizationBillingHistory";

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

function subscription() {
  return {
    currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
    currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
    productId: "sync_team_5_monthly:monthly",
    store: "play_store" as const,
    subscriptionId: "GPA.native-transfer",
  };
}

test("atomically moves a native subscription between personal organizations", async () => {
  const previous = await registerPersonalOrganization();
  const destination = await registerPersonalOrganization();
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: previous.user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: subscription().subscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, previous.organizationId));

  const eventId = crypto.randomUUID();
  const result = await runClaimNativeSubscriptionWorkflow({
    appUserId: destination.user.userId,
    auditEvent: { eventId, eventTimestamp: new Date() },
    db,
    organizationId: destination.organizationId,
    requireSessionAccess: false,
    sourceId: eventId,
    subscription: subscription(),
  });
  expect(result).toEqual({
    duplicate: false,
    sourceOrganizationId: previous.organizationId,
  });

  const [oldBilling] = await db
    .select({
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, previous.organizationId));
  expect(oldBilling).toEqual({
    providerSubscriptionId: null,
    seatCount: 0,
    status: "disabled",
  });
  const [newBilling] = await db
    .select({
      providerCustomerId: organizationBilling.providerCustomerId,
      providerProductId: organizationBilling.providerProductId,
      providerSubscriptionId: organizationBilling.providerSubscriptionId,
      seatCount: organizationBilling.seatCount,
      status: organizationBilling.status,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, destination.organizationId));
  expect(newBilling).toEqual({
    providerCustomerId: destination.user.userId,
    providerProductId: "sync_team_5_monthly:monthly",
    providerSubscriptionId: subscription().subscriptionId,
    seatCount: 5,
    status: "active",
  });
  const [audit] = await db
    .select({
      organizationId: revenuecatWebhookEvents.organizationId,
      sourceOrganizationId: revenuecatWebhookEvents.sourceOrganizationId,
    })
    .from(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.eventId, eventId));
  expect(audit).toEqual({
    organizationId: destination.organizationId,
    sourceOrganizationId: previous.organizationId,
  });
  const previousHistory = await runGetOrganizationBillingHistoryWorkflow(
    db,
    previous.organizationId,
    previous.user.userId,
  );
  const destinationHistory = await runGetOrganizationBillingHistoryWorkflow(
    db,
    destination.organizationId,
    destination.user.userId,
  );
  expect(
    previousHistory.some((entry) => entry.eventType === "TRANSFER_OUT"),
  ).toBe(true);
  expect(
    destinationHistory.some((entry) => entry.eventType === "TRANSFER_IN"),
  ).toBe(true);

  expect(
    await runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      auditEvent: { eventId, eventTimestamp: new Date() },
      db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: eventId,
      subscription: subscription(),
    }),
  ).toEqual({ duplicate: true, sourceOrganizationId: null });
});

test("rejects custom organizations and Stripe-bound destinations", async () => {
  const source = await registerPersonalOrganization();
  const destination = await registerPersonalOrganization();

  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      db,
      organizationId: source.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: { ...subscription(), subscriptionId: crypto.randomUUID() },
    }),
  ).rejects.toBeInstanceOf(OrganizationManagerError);

  await db
    .update(organizationBillingStripeSeats)
    .set({ subscriptionId: `sub_${crypto.randomUUID()}` })
    .where(
      eq(
        organizationBillingStripeSeats.organizationId,
        destination.organizationId,
      ),
    );
  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: { ...subscription(), subscriptionId: crypto.randomUUID() },
    }),
  ).rejects.toThrow(
    "Cancel the organization's web subscription before moving a native subscription",
  );
});

test("concurrent claims cannot leave one subscription bound to two organizations", async () => {
  const first = await registerPersonalOrganization();
  const second = await registerPersonalOrganization();
  const claims = await Promise.allSettled([
    runClaimNativeSubscriptionWorkflow({
      appUserId: first.user.userId,
      db,
      organizationId: first.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: subscription(),
    }),
    runClaimNativeSubscriptionWorkflow({
      appUserId: second.user.userId,
      db,
      organizationId: second.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: subscription(),
    }),
  ]);

  expect(
    claims.filter((claim) => claim.status === "fulfilled").length,
  ).toBeGreaterThanOrEqual(1);
  const owners = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      eq(
        organizationBilling.providerSubscriptionId,
        subscription().subscriptionId,
      ),
    );
  expect(owners).toHaveLength(1);
});
