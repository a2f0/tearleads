import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
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
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });

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
      START,
      () => "oversized-roster-token",
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
