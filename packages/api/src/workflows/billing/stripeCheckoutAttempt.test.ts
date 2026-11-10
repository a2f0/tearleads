import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { getSyncBillingTier } from "@tearleads/validators/billing";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  addEffectiveOrganizationMember,
  addSyntheticEffectiveOrganizationMembers,
} from "../../../test/helpers/revenuecatWebhook";
import { runAcquireStripeCheckoutAttemptWorkflow } from "./stripeCheckout";

const START = new Date("2030-01-01T00:00:00.000Z");
const SOLO = getSyncBillingTier("solo");
const TEAM_5 = getSyncBillingTier("team_5");

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

async function addMember(admin: TestUser, organizationId: string) {
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
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
      { createAttemptId: () => "inline-token", now: START, plan: SOLO },
    ),
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "hosted",
      { createAttemptId: () => "hosted-token", now: START, plan: SOLO },
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
      { createAttemptId: () => "first-token", now: START, plan: SOLO },
    ),
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      { createAttemptId: () => "second-token", now: START, plan: SOLO },
    ),
  ]);
  expect(first.attemptId).toBe(second.attemptId);
  expect(first.seatQuantity).toBe(1);
  expect(second.seatQuantity).toBe(1);
});

test("choosing another plan rotates the buyer's inline attempt once", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const first = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "inline",
    { createAttemptId: () => "solo-token", now: START, plan: SOLO },
  );
  const later = new Date("2030-01-01T00:01:00.000Z");
  const acquire = (token: string) =>
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      { createAttemptId: () => token, now: later, plan: TEAM_5 },
    );

  expect(first.seatQuantity).toBe(1);
  const [left, right] = await Promise.all([
    acquire("left-token"),
    acquire("right-token"),
  ]);
  expect(left).toEqual(right);
  expect(left.seatQuantity).toBe(5);
  expect(["left-token", "right-token"]).toContain(left.attemptId);
});

test("a roster that grows within the chosen plan keeps the attempt", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  const first = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    { createAttemptId: () => "team-token", now: START, plan: TEAM_5 },
  );
  await addMember(admin, organizationId);

  const retry = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    {
      createAttemptId: () => "unused",
      now: new Date("2030-01-01T00:01:00.000Z"),
      plan: TEAM_5,
    },
  );
  expect(retry.attemptId).toBe(first.attemptId);
});

test("a hosted attempt for another plan is never replaced", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    { createAttemptId: () => "hosted-solo", now: START, plan: SOLO },
  );

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "hosted",
      {
        createAttemptId: () => "unused",
        now: new Date("2030-01-01T00:01:00.000Z"),
        plan: TEAM_5,
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
});

test("a plan the roster has outgrown is refused and reserves nothing", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  await addMember(admin, organizationId);

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      { createAttemptId: () => "unused", now: START, plan: SOLO },
    ),
  ).rejects.toMatchObject({
    code: "billing_checkout_plan_unavailable",
    status: 409,
  });
  const [billing] = await db
    .select({ attemptId: organizationBilling.checkoutAttemptId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.attemptId).toBeNull();
});

test("checkout rejects an effective roster above the largest tier", async () => {
  const admin = createTestUser();
  const organizationId = await registerAdmin(admin);
  await addSyntheticEffectiveOrganizationMembers({
    actor: admin,
    count: 10,
    organizationId,
  });

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "inline",
      {
        createAttemptId: () => "oversized-roster-token",
        now: START,
        plan: SOLO,
      },
    ),
  ).rejects.toMatchObject({
    code: "billing_roster_over_capacity",
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
    { createAttemptId: () => "hosted-first", now: START, plan: SOLO },
  );
  const retry = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    {
      createAttemptId: () => "unused",
      now: new Date("2030-01-01T00:14:59.000Z"),
      plan: SOLO,
    },
  );
  expect(retry.attemptId).toBe(first.attemptId);
  expect(retry.providerExpiresAt).toEqual(new Date("2030-01-01T00:45:00.000Z"));

  await expect(
    runAcquireStripeCheckoutAttemptWorkflow(
      db,
      organizationId,
      admin.userId,
      "hosted",
      {
        createAttemptId: () => "too-early",
        now: new Date("2030-01-01T00:15:00.000Z"),
        plan: SOLO,
      },
    ),
  ).rejects.toMatchObject({ status: 409 });

  const rotated = await runAcquireStripeCheckoutAttemptWorkflow(
    db,
    organizationId,
    admin.userId,
    "hosted",
    {
      createAttemptId: () => "hosted-next",
      now: new Date("2030-01-01T00:51:00.000Z"),
      plan: SOLO,
    },
  );
  expect(rotated.attemptId).toBe("hosted-next");
  expect(rotated.providerExpiresAt).toEqual(
    new Date("2030-01-01T01:36:00.000Z"),
  );
});
