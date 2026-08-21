import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBilling } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerAndAuthenticate } from "../../../test/helpers/organizationBillingHistory";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { expireOrganizationTrials } from "./organizationTrialExpiry";

test("trial expiry service treats a non-positive batch limit as a no-op", async () => {
  const organizationId = await registerAndAuthenticate(createTestUser());
  const [trial] = await db
    .select({ trialEndsAt: organizationBilling.trialEndsAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(trial?.trialEndsAt, "expected provisioned trial");

  expect(
    await expireOrganizationTrials(createServiceTestRuntime(), {
      limit: 0,
      now: new Date(trial.trialEndsAt.getTime() + 1),
      organizationIds: [organizationId],
    }),
  ).toEqual({
    attentionRequired: 0,
    examined: 0,
    expired: 0,
    failed: 0,
  });
});

test("trial expiry service persists an expired trial", async () => {
  const organizationId = await registerAndAuthenticate(createTestUser());
  const [trial] = await db
    .select({ trialEndsAt: organizationBilling.trialEndsAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(trial?.trialEndsAt, "expected provisioned trial");

  expect(
    await expireOrganizationTrials(createServiceTestRuntime(), {
      now: new Date(trial.trialEndsAt.getTime() + 1),
      organizationIds: [organizationId],
    }),
  ).toEqual({
    attentionRequired: 0,
    examined: 1,
    expired: 1,
    failed: 0,
  });

  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.status).toBe("disabled");
});
