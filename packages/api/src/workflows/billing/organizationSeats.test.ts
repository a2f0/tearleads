import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
  organizationBillingStripeSeats,
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";

const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z");
const NOW = new Date("2026-07-15T00:00:00.000Z");

async function createBillableOrganization(): Promise<{
  readonly memberGroupId: string;
  readonly organizationId: string;
}> {
  const organizationId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    adminGroupId: crypto.randomUUID(),
    memberGroupId,
    name: "Seat Accounting Org",
  });
  await db.insert(organizationBilling).values({
    organizationId,
    status: "active",
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
  });
  return { memberGroupId, organizationId };
}

async function insertMemberGroupState(input: {
  readonly groupId: string;
  readonly signerUserId: string;
  readonly stateHash: string;
  readonly userIds: readonly string[];
  readonly version: number;
}): Promise<void> {
  await db.insert(principalStates).values({
    principalType: "group",
    principalId: input.groupId,
    version: input.version,
    prevStateHash: input.version === 1 ? null : `state-${input.version - 1}`,
    keyEpoch: 1,
    encapsulationPublicKey: "encapsulation-public-key",
    keyFingerprint: "key-fingerprint",
    membershipMode: "projection",
    membershipRoot: `membership-root-${input.version}`,
    memberEnvelopesRoot: `member-envelopes-root-${input.version}`,
    projectionRoot: `projection-root-${input.version}`,
    payloadCiphertextHash: `payload-ciphertext-hash-${input.version}`,
    memberCount: input.userIds.length,
    stateHash: input.stateHash,
    signedAt: NOW,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: "signer-key-fingerprint",
    signature: `signature-${input.version}`,
  });

  if (input.userIds.length === 0) {
    return;
  }
  await db.insert(principalMembershipProjection).values(
    input.userIds.map((userId) => ({
      principalType: "group" as const,
      principalId: input.groupId,
      stateHash: input.stateHash,
      memberPrincipalType: "user" as const,
      memberPrincipalId: userId,
      role: "member" as const,
    })),
  );
}

async function readSeatCount(organizationId: string): Promise<number> {
  const [billing] = await db
    .select({ seatCount: organizationBilling.seatCount })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected billing row");
  return billing.seatCount;
}

async function readOpenAssignmentUserIds(
  organizationId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: organizationBillingSeatAssignments.userId })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(organizationBillingSeatAssignments.organizationId, organizationId),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  return rows.map((row) => row.userId).sort();
}

async function readSeatEventTypes(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ eventType: organizationBillingSeatEvents.eventType })
    .from(organizationBillingSeatEvents)
    .where(eq(organizationBillingSeatEvents.organizationId, organizationId));
  return rows.map((row) => row.eventType);
}

test("seat accounting reuses released seats and only increases concurrent capacity", async () => {
  const { memberGroupId, organizationId } = await createBillableOrganization();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const userC = crypto.randomUUID();

  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userA,
    stateHash: "state-1",
    userIds: [userA],
    version: 1,
  });
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "state-1", sourceType: "principal_state" },
  });
  expect(await readSeatCount(organizationId)).toBe(1);
  expect(await readOpenAssignmentUserIds(organizationId)).toEqual([userA]);

  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userA,
    stateHash: "state-2",
    userIds: [userB],
    version: 2,
  });
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "state-2", sourceType: "principal_state" },
  });
  expect(await readSeatCount(organizationId)).toBe(1);
  expect(await readOpenAssignmentUserIds(organizationId)).toEqual([userB]);

  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userB,
    stateHash: "state-3",
    userIds: [userB, userC],
    version: 3,
  });
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "state-3", sourceType: "principal_state" },
  });
  expect(await readSeatCount(organizationId)).toBe(2);
  expect(await readOpenAssignmentUserIds(organizationId)).toEqual(
    [userB, userC].sort(),
  );
  expect(await readSeatEventTypes(organizationId)).toContain(
    "licensed_seat_count_increased",
  );
});

test("an empty roster resets capacity when the explicit billing period changes", async () => {
  const { memberGroupId, organizationId } = await createBillableOrganization();
  const userId = crypto.randomUUID();
  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userId,
    stateHash: "state-1",
    userIds: [userId],
    version: 1,
  });
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "state-1", sourceType: "principal_state" },
  });

  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userId,
    stateHash: "state-2",
    userIds: [],
    version: 2,
  });
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "state-2", sourceType: "principal_state" },
  });
  expect(await readSeatCount(organizationId)).toBe(1);
  expect(await readOpenAssignmentUserIds(organizationId)).toEqual([]);

  const nextStart = PERIOD_END;
  const nextEnd = new Date("2026-09-01T00:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({
      currentPeriodStartsAt: nextStart,
      currentPeriodEndsAt: nextEnd,
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await reconcileOrganizationBillingSeats({
    executor: db,
    now: new Date("2026-08-02T00:00:00.000Z"),
    organizationId,
    source: { sourceId: "renewal-1", sourceType: "provider_event" },
  });

  expect(await readSeatCount(organizationId)).toBe(1);
  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(stripeSeats).toMatchObject({
    // A live Stripe subscription retains one billable seat even while its
    // effective Members group is empty.
    desiredPaidCapacity: 1,
    desiredRenewalQuantity: 1,
  });
});

test("a migrated row initializes its period key without losing paid capacity", async () => {
  const { memberGroupId, organizationId } = await createBillableOrganization();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  await db
    .update(organizationBilling)
    .set({ seatCount: 3, seatPeriodKey: null })
    .where(eq(organizationBilling.organizationId, organizationId));
  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userA,
    stateHash: "migrated-state-1",
    userIds: [userA, userB],
    version: 1,
  });

  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "migrated-state-1", sourceType: "principal_state" },
  });

  expect(await readSeatCount(organizationId)).toBe(3);
  expect(await readOpenAssignmentUserIds(organizationId)).toEqual(
    [userA, userB].sort(),
  );
  const [stripeSeats] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(stripeSeats).toMatchObject({
    desiredPaidCapacity: 5,
    desiredRenewalQuantity: 5,
  });
});

test("a native fixed tier blocks membership beyond its capacity", async () => {
  const { memberGroupId, organizationId } = await createBillableOrganization();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerProductId: "sync_solo_monthly",
      seatCount: 1,
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  await insertMemberGroupState({
    groupId: memberGroupId,
    signerUserId: userA,
    stateHash: "native-solo-state",
    userIds: [userA, userB],
    version: 1,
  });

  expect(
    reconcileOrganizationBillingSeats({
      executor: db,
      now: NOW,
      organizationId,
      source: {
        sourceId: "native-solo-state",
        sourceType: "principal_state",
      },
    }),
  ).rejects.toThrow(
    "Upgrade the subscription before adding more than 1 members",
  );
  expect(await readSeatCount(organizationId)).toBe(1);
  const stripeRows = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId));
  expect(stripeRows).toHaveLength(0);
});
