import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingLifecycleEvents,
  organizationBillingSeatAssignments,
  organizationBillingSeatEvents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingHistoryResponse } from "@tearleads/validators/response";
import { and, asc, eq, inArray } from "drizzle-orm";
import invariant from "invariant";
import {
  billingAuthHeader,
  registerAndAuthenticate,
} from "../../../test/helpers/organizationBillingHistory";
import { LAPSED_BILLING_PURGE_GRACE_MS } from "../../billing/organizationBilling";
import { routeApp } from "../../routeApp";
import {
  runExpireOrganizationTrialsWorkflow,
  runExpireOrganizationTrialWorkflow,
} from "./organizationTrialLifecycle";

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
    trialExpiryAttemptCount: 0,
    trialExpiryLastError: null,
    trialExpiryNextAttemptAt: null,
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
  expect(history.entries.map((entry) => entry.eventType).sort()).toEqual([
    "free_trial_expired",
    "free_trial_initialized",
  ]);
  const initializedHistory = history.entries.find(
    (entry) => entry.eventType === "free_trial_initialized",
  );
  expect(initializedHistory).toMatchObject({
    activeSeatCount: 1,
    category: "lifecycle",
    provider: "internal",
    seatCount: 10,
    seatDelta: 10,
  });

  const [assignmentEvent] = await db
    .select({
      sourcePrincipalId: organizationBillingSeatEvents.sourcePrincipalId,
      sourcePrincipalType: organizationBillingSeatEvents.sourcePrincipalType,
    })
    .from(organizationBillingSeatEvents)
    .where(
      and(
        eq(organizationBillingSeatEvents.organizationId, organizationId),
        eq(organizationBillingSeatEvents.eventType, "seat_assigned"),
      ),
    );
  expect(assignmentEvent).toMatchObject({
    sourcePrincipalType: "group",
  });
  expect(assignmentEvent?.sourcePrincipalId).not.toBeNull();
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
  await db
    .update(organizationBilling)
    .set({
      status: "local",
      trialEndsAt: null,
      trialExpiryNextAttemptAt: null,
    })
    .where(eq(organizationBilling.organizationId, organizationId));
});

test("trial sweep backs off failures without starving later expirations", async () => {
  const organizationIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    organizationIds.push(await registerAndAuthenticate(createTestUser()));
  }
  const trials = await db
    .select({
      organizationId: organizationBilling.organizationId,
      trialEndsAt: organizationBilling.trialEndsAt,
    })
    .from(organizationBilling)
    .where(inArray(organizationBilling.organizationId, organizationIds));
  expect(trials).toHaveLength(3);
  const ordered = trials
    .map((trial) => {
      invariant(trial.trialEndsAt, "expected provisioned trial");
      return { ...trial, trialEndsAt: trial.trialEndsAt };
    })
    .sort(
      (left, right) =>
        left.trialEndsAt.getTime() - right.trialEndsAt.getTime() ||
        left.organizationId.localeCompare(right.organizationId),
    );
  const failing = ordered[0];
  invariant(failing, "expected first trial");
  await db
    .delete(organizationBillingLifecycleEvents)
    .where(
      eq(
        organizationBillingLifecycleEvents.organizationId,
        failing.organizationId,
      ),
    );
  const now = new Date(
    Math.max(...ordered.map((trial) => trial.trialEndsAt.getTime())) + 1,
  );
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      await runExpireOrganizationTrialsWorkflow(db, { limit: 2, now }),
    ).toEqual({ examined: 2, expired: 1, failed: 1 });
    expect(
      await runExpireOrganizationTrialsWorkflow(db, { limit: 2, now }),
    ).toEqual({ examined: 1, expired: 1, failed: 0 });
  } finally {
    errorSpy.mockRestore();
  }

  const billingRows = await db
    .select({
      organizationId: organizationBilling.organizationId,
      status: organizationBilling.status,
      trialExpiryAttemptCount: organizationBilling.trialExpiryAttemptCount,
      trialExpiryLastError: organizationBilling.trialExpiryLastError,
      trialExpiryNextAttemptAt: organizationBilling.trialExpiryNextAttemptAt,
    })
    .from(organizationBilling)
    .where(inArray(organizationBilling.organizationId, organizationIds));
  const byOrganizationId = new Map(
    billingRows.map((row) => [row.organizationId, row]),
  );
  expect(byOrganizationId.get(failing.organizationId)).toMatchObject({
    status: "trialing",
    trialExpiryAttemptCount: 1,
    trialExpiryLastError: "Expired free trial has no initialization event",
  });
  expect(
    byOrganizationId
      .get(failing.organizationId)
      ?.trialExpiryNextAttemptAt?.getTime(),
  ).toBeGreaterThan(now.getTime());
  for (const expired of ordered.slice(1)) {
    expect(byOrganizationId.get(expired.organizationId)?.status).toBe(
      "disabled",
    );
  }
});
