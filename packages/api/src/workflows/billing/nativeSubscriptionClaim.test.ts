import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
  organizations,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
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

function subscription(subscriptionId: string) {
  return {
    currentPeriodEndsAt: new Date("2030-02-01T00:00:00Z"),
    currentPeriodStartsAt: new Date("2030-01-01T00:00:00Z"),
    productId: "sync_team_5_monthly:monthly",
    store: "play_store" as const,
    subscriptionId,
  };
}

test("atomically moves a native subscription between personal organizations", async () => {
  const previous = await registerPersonalOrganization();
  const destination = await registerPersonalOrganization();
  const nativeSubscription = subscription(`GPA.${crypto.randomUUID()}`);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: previous.user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: nativeSubscription.subscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, previous.organizationId));
  await db.insert(organizationBillingSeatAssignments).values({
    assignedAt: new Date(),
    assignmentSourceId: "existing-native-subscription",
    assignmentSourceType: "provider_event",
    organizationId: previous.organizationId,
    userId: previous.user.userId,
  });

  const eventId = crypto.randomUUID();
  const result = await runClaimNativeSubscriptionWorkflow({
    appUserId: destination.user.userId,
    auditEvent: { eventId, eventTimestamp: new Date() },
    db,
    organizationId: destination.organizationId,
    requireSessionAccess: false,
    sourceId: eventId,
    subscription: nativeSubscription,
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
    providerSubscriptionId: nativeSubscription.subscriptionId,
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
  const openPreviousSeats = await db
    .select({ id: organizationBillingSeatAssignments.id })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(
          organizationBillingSeatAssignments.organizationId,
          previous.organizationId,
        ),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  const releasedPreviousSeats = await db
    .select({ eventType: organizationBillingSeatEvents.eventType })
    .from(organizationBillingSeatEvents)
    .where(
      and(
        eq(
          organizationBillingSeatEvents.organizationId,
          previous.organizationId,
        ),
        eq(organizationBillingSeatEvents.eventType, "seat_released"),
        eq(organizationBillingSeatEvents.sourceId, eventId),
      ),
    );
  expect(openPreviousSeats).toHaveLength(0);
  expect(releasedPreviousSeats.length).toBeGreaterThanOrEqual(1);

  expect(
    await runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      auditEvent: { eventId, eventTimestamp: new Date() },
      db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: eventId,
      subscription: nativeSubscription,
    }),
  ).toEqual({ duplicate: true, sourceOrganizationId: null });
});

test("rejects custom organizations and Stripe-bound destinations", async () => {
  const destination = await registerPersonalOrganization();
  const customOrganizationId = crypto.randomUUID();
  await db.insert(organizations).values({
    adminGroupId: crypto.randomUUID(),
    id: customOrganizationId,
    memberGroupId: crypto.randomUUID(),
    name: "Custom organization",
  });
  await db.insert(organizationBilling).values({
    organizationId: customOrganizationId,
  });

  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      db,
      organizationId: customOrganizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: subscription(crypto.randomUUID()),
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
      subscription: subscription(crypto.randomUUID()),
    }),
  ).rejects.toThrow(
    "Cancel the organization's web subscription before moving a native subscription",
  );
});

test("rejects unknown products and a different destination subscription", async () => {
  const destination = await registerPersonalOrganization();
  const unknownProduct = {
    ...subscription(crypto.randomUUID()),
    productId: "unconfigured_native_product",
  };
  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: unknownProduct,
    }),
  ).rejects.toThrow(
    "The native subscription product is not configured for sync billing",
  );

  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "sync_solo_monthly:monthly",
      providerSubscriptionId: `existing-${crypto.randomUUID()}`,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, destination.organizationId));
  await expect(
    runClaimNativeSubscriptionWorkflow({
      appUserId: destination.user.userId,
      db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: subscription(crypto.randomUUID()),
    }),
  ).rejects.toThrow(
    "The personal organization already has a different subscription",
  );
});

/** The API package runs this concurrency case on memory and SQLite adapters. */
test("the database matrix leaves one owner after concurrent claims", async () => {
  const first = await registerPersonalOrganization();
  const second = await registerPersonalOrganization();
  const nativeSubscription = subscription(`GPA.${crypto.randomUUID()}`);
  const claims = await Promise.allSettled([
    runClaimNativeSubscriptionWorkflow({
      appUserId: first.user.userId,
      db,
      organizationId: first.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: nativeSubscription,
    }),
    runClaimNativeSubscriptionWorkflow({
      appUserId: second.user.userId,
      db,
      organizationId: second.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: nativeSubscription,
    }),
  ]);

  if (claims.every((claim) => claim.status === "rejected")) {
    await runClaimNativeSubscriptionWorkflow({
      appUserId: first.user.userId,
      db,
      organizationId: first.organizationId,
      requireSessionAccess: false,
      sourceId: crypto.randomUUID(),
      subscription: nativeSubscription,
    });
  }
  const owners = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      eq(
        organizationBilling.providerSubscriptionId,
        nativeSubscription.subscriptionId,
      ),
    );
  expect(owners).toHaveLength(1);
});
