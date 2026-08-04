import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
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
  ).toEqual({ examined: 0, expired: 0, failed: 0 });
});
