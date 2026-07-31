import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizations,
  principalMembershipProjection,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { and, desc, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { runAcquireStripeCheckoutAttemptWorkflow } from "./stripeCheckout";

const START = new Date("2030-01-01T00:00:00.000Z");

async function registerAdmin(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function addEffectiveMember(
  organizationId: string,
  userId: string,
): Promise<void> {
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization row");
  const [state] = await db
    .select({ stateHash: principalStates.stateHash })
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        eq(principalStates.principalId, organization.memberGroupId),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(1);
  invariant(state, "expected current Members-group state");
  await db.insert(principalMembershipProjection).values({
    memberPrincipalId: userId,
    memberPrincipalType: "user",
    principalId: organization.memberGroupId,
    principalType: "group",
    role: "member",
    stateHash: state.stateHash,
  });
}

test("inline and hosted checkout have exactly one concurrent winner", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const attempts = await Promise.allSettled([
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      START,
      () => "inline-token",
    ),
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "hosted",
      START,
      () => "hosted-token",
    ),
  ]);
  const winners = attempts.filter((result) => result.status === "fulfilled");
  const conflicts = attempts.filter((result) => result.status === "rejected");
  expect(winners).toHaveLength(1);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.reason).toMatchObject({ status: 409 });
});

test("same-mode concurrent retries reuse one durable token", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const [first, second] = await Promise.all([
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      START,
      () => "first-token",
    ),
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      START,
      () => "second-token",
    ),
  ]);
  expect(first.attemptId).toBe(second.attemptId);
  expect(first.seatQuantity).toBe(1);
  expect(second.seatQuantity).toBe(1);
});

test("changed seat terms cannot replace an active attempt snapshot", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const first = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "inline",
    START,
    () => "one-seat-token",
  );
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveMember(organizationId, member.userId);

  expect(first.seatQuantity).toBe(1);
  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      new Date("2030-01-01T00:01:00.000Z"),
      () => "two-seat-token",
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("checkout rejects an effective roster above the largest tier", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  for (let index = 0; index < 10; index += 1) {
    await addEffectiveMember(organizationId, crypto.randomUUID());
  }

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      START,
      () => "oversized-roster-token",
    ),
  ).rejects.toMatchObject({
    message:
      "The organization exceeds the maximum subscription tier of 10 members",
    status: 409,
  });
});

test("hosted retries stop before Stripe's minimum expiry and later rotate", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const first = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    START,
    () => "hosted-first",
  );
  const retry = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    new Date("2030-01-01T00:14:59.000Z"),
    () => "unused",
  );
  expect(retry.attemptId).toBe(first.attemptId);
  expect(retry.providerExpiresAt).toEqual(new Date("2030-01-01T00:45:00.000Z"));

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "hosted",
      new Date("2030-01-01T00:15:00.000Z"),
      () => "too-early",
    ),
  ).rejects.toMatchObject({ status: 409 });

  const rotated = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    new Date("2030-01-01T00:51:00.000Z"),
    () => "hosted-next",
  );
  expect(rotated.attemptId).toBe("hosted-next");
  expect(rotated.providerExpiresAt).toEqual(
    new Date("2030-01-01T01:36:00.000Z"),
  );
});
