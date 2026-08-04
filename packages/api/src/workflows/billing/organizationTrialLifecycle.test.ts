import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
  organizationBillingSeatAssignments,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingHistoryResponse } from "@tearleads/validators/response";
import { asc, eq } from "drizzle-orm";
import invariant from "invariant";
import {
  billingAuthHeader,
  registerAndAuthenticate,
} from "../../../test/helpers/organizationBillingHistory";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "../../billing/organizationBilling";
import { routeApp } from "../../routeApp";
import { runExpireOrganizationTrialWorkflow } from "./organizationTrialLifecycle";

test("trial inception and expiration remain durable user-facing lifecycle events", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const [trial] = await db
    .select({ trialEndsAt: organizationBilling.trialEndsAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(trial?.trialEndsAt, "expected provisioned trial");
  const sweepAt = new Date(trial.trialEndsAt.getTime() + 1);

  expect(
    await runExpireOrganizationTrialWorkflow(db, organizationId, sweepAt),
  ).toBe(true);
  expect(
    await runExpireOrganizationTrialWorkflow(db, organizationId, sweepAt),
  ).toBe(false);

  const [billing] = await db
    .select()
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(billing, "expected billing row");
  expect(billing).toMatchObject({
    disabledAt: trial.trialEndsAt,
    seatCount: 0,
    seatPeriodKey: null,
    status: "disabled",
    trialEndsAt: null,
  });
  expect(billing.purgeAfter).toEqual(
    new Date(trial.trialEndsAt.getTime() + LAPSED_BILLING_PURGE_GRACE_MS),
  );

  const lifecycle = await db
    .select()
    .from(organizationBillingLifecycleEvents)
    .where(
      eq(organizationBillingLifecycleEvents.organizationId, organizationId),
    )
    .orderBy(asc(organizationBillingLifecycleEvents.occurredAt));
  expect(lifecycle).toHaveLength(2);
  expect(lifecycle[0]).toMatchObject({
    activeSeatCount: 1,
    eventType: "free_trial_initialized",
    licensedSeatCount: 10,
    quantityDelta: 10,
  });
  expect(lifecycle[1]).toMatchObject({
    activeSeatCount: 0,
    eventType: "free_trial_expired",
    licensedSeatCount: 0,
    occurredAt: trial.trialEndsAt,
    periodEndsAt: trial.trialEndsAt,
    quantityDelta: -10,
  });
  expect(lifecycle[1]?.periodStartsAt).toEqual(lifecycle[0]?.periodStartsAt);
  expect(lifecycle[1]?.sourceId).toBe(lifecycle[0]?.sourceId);

  const assignments = await db
    .select({ releasedAt: organizationBillingSeatAssignments.releasedAt })
    .from(organizationBillingSeatAssignments)
    .where(
      eq(organizationBillingSeatAssignments.organizationId, organizationId),
    );
  expect(assignments).toHaveLength(1);
  expect(assignments[0]?.releasedAt).toEqual(trial.trialEndsAt);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: billingAuthHeader(admin) },
  );
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.entries.map((entry) => entry.eventType)).toEqual([
    "free_trial_expired",
    "free_trial_initialized",
  ]);
  expect(history.entries[1]).toMatchObject({
    activeSeatCount: 1,
    category: "lifecycle",
    provider: "internal",
    seatCount: 10,
    seatDelta: 10,
  });
});

test("trial expiration fails closed when its durable inception is missing", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const [trial] = await db
    .select({ trialEndsAt: organizationBilling.trialEndsAt })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  invariant(trial?.trialEndsAt, "expected provisioned trial");
  await db
    .delete(organizationBillingLifecycleEvents)
    .where(
      eq(organizationBillingLifecycleEvents.organizationId, organizationId),
    );

  await expect(
    runExpireOrganizationTrialWorkflow(
      db,
      organizationId,
      new Date(trial.trialEndsAt.getTime() + 1),
    ),
  ).rejects.toThrow("Expired free trial has no initialization event");

  const [billing] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.status).toBe("trialing");
});
