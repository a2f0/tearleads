import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { ROOT_OPS_HEALTH_SECTION_LIMIT } from "@tearleads/validators/response";
import { loadRootOpsHealthReport } from "./opsHealth";

// Far from the dates other suites write, so their rows stay out of the window.
const NOW = new Date("1990-06-15T12:00:00.000Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const at = (deltaMs: number) => new Date(NOW.getTime() + deltaMs);

type BillingRow = typeof organizationBilling.$inferInsert;
type SeatsRow = typeof organizationBillingStripeSeats.$inferInsert;

async function organization(
  billing: Omit<BillingRow, "organizationId">,
  seats?: Omit<SeatsRow, "organizationId">,
): Promise<string> {
  const organizationId = randomUUID();
  await db.insert(organizationBilling).values({ ...billing, organizationId });
  if (seats) {
    await db
      .insert(organizationBillingStripeSeats)
      .values({ ...seats, organizationId });
  }
  return organizationId;
}

/** A row the seat-sync worker can claim: bound to a Stripe item and price. */
function boundSeats(
  fields: Omit<SeatsRow, "organizationId">,
): Omit<SeatsRow, "organizationId"> {
  return {
    priceId: "price_ops",
    subscriptionId: `sub_${randomUUID()}`,
    subscriptionItemId: `si_${randomUUID()}`,
    ...fields,
  };
}

function ids(rows: readonly { organizationId: string }[]): string[] {
  return rows.map((row) => row.organizationId);
}

test("seat sync lists failed, stalled and lapsed-lease rows the worker would claim", async () => {
  const active = { status: "active" } as const;
  const failing = await organization(
    active,
    boundSeats({
      attemptCount: 2,
      lastError: "Stripe rejected the quantity",
      nextAttemptAt: at(30 * MINUTE),
    }),
  );
  const healthy = await organization(
    active,
    boundSeats({ nextAttemptAt: at(30 * MINUTE) }),
  );
  const stalled = await organization(
    active,
    boundSeats({
      appliedRevision: 3,
      desiredRevision: 4,
      nextAttemptAt: at(-16 * MINUTE),
    }),
  );
  const justDue = await organization(
    active,
    boundSeats({ nextAttemptAt: at(-14 * MINUTE) }),
  );
  const lapsedLease = await organization(
    active,
    boundSeats({
      leaseExpiresAt: at(-1000),
      leaseId: "lease-lapsed",
      nextAttemptAt: at(-2 * MINUTE),
    }),
  );
  const heldLease = await organization(
    active,
    boundSeats({
      leaseExpiresAt: at(MINUTE),
      leaseId: "lease-held",
      nextAttemptAt: at(-2 * MINUTE),
    }),
  );
  const disabledOrganization = await organization(
    { status: "disabled" },
    boundSeats({ lastError: "stale", nextAttemptAt: at(-MINUTE) }),
  );
  const unbound = await organization(active, {
    lastError: "quarantined",
    nextAttemptAt: at(-MINUTE),
  });

  const { seatSync } = await loadRootOpsHealthReport(db, NOW);
  const listed = ids(seatSync.rows);
  expect(listed).toEqual(
    expect.arrayContaining([failing, stalled, lapsedLease]),
  );
  for (const absent of [
    healthy,
    justDue,
    heldLease,
    disabledOrganization,
    unbound,
  ]) {
    expect(listed).not.toContain(absent);
  }
  const byId = new Map(seatSync.rows.map((row) => [row.organizationId, row]));
  expect(byId.get(failing)).toMatchObject({
    attemptCount: 2,
    conditions: ["failing"],
    lastError: "Stripe rejected the quantity",
  });
  expect(byId.get(stalled)).toMatchObject({
    appliedRevision: 3,
    conditions: ["stalled"],
    desiredRevision: 4,
  });
  expect(byId.get(lapsedLease)?.conditions).toEqual(["leaseExpired"]);
  // Retry order: the longest-overdue row comes first.
  expect(listed.indexOf(stalled)).toBeLessThan(listed.indexOf(lapsedLease));
  expect(listed.indexOf(lapsedLease)).toBeLessThan(listed.indexOf(failing));
});

test("trial expiry lists failed sweeps and trials the sweep is overdue on", async () => {
  const overdue = await organization({
    status: "trialing",
    trialEndsAt: at(-60 * MINUTE),
  });
  const justEnded = await organization({
    status: "trialing",
    trialEndsAt: at(-5 * MINUTE),
  });
  const exhausted = await organization({
    status: "trialing",
    trialEndsAt: at(-5 * MINUTE),
    trialExpiryAttemptCount: 8,
    trialExpiryLastError: "seat snapshot failed",
    trialExpiryNextAttemptAt: at(30 * MINUTE),
  });
  const retrying = await organization({
    status: "trialing",
    trialEndsAt: at(-5 * MINUTE),
    trialExpiryAttemptCount: 7,
    trialExpiryLastError: "seat snapshot failed",
  });
  const notEnded = await organization({
    status: "trialing",
    trialEndsAt: at(60 * MINUTE),
    trialExpiryAttemptCount: 3,
  });

  const { trialExpiry, trialsEnding } = await loadRootOpsHealthReport(db, NOW);
  const listed = ids(trialExpiry.rows);
  expect(listed).toEqual(
    expect.arrayContaining([overdue, exhausted, retrying]),
  );
  expect(listed).not.toContain(justEnded);
  expect(listed).not.toContain(notEnded);
  const byId = new Map(
    trialExpiry.rows.map((row) => [row.organizationId, row]),
  );
  expect(byId.get(overdue)).toMatchObject({
    attemptCount: 0,
    requiresAttention: false,
    trialEndsAt: at(-60 * MINUTE).toISOString(),
  });
  expect(byId.get(exhausted)).toMatchObject({
    attemptCount: 8,
    lastError: "seat snapshot failed",
    nextAttemptAt: at(30 * MINUTE).toISOString(),
    requiresAttention: true,
  });
  expect(byId.get(retrying)?.requiresAttention).toBe(false);
  expect(ids(trialsEnding.rows)).toContain(notEnded);
});

test("purges list overdue starts and lapsed claims", async () => {
  const overdueStart = await organization({
    purgeAfter: at(-16 * MINUTE),
    status: "disabled",
  });
  const justDue = await organization({
    purgeAfter: at(-14 * MINUTE),
    status: "disabled",
  });
  const lapsedClaim = await organization({
    purgeAfter: at(-DAY),
    purgeStartedAt: at(-6 * MINUTE),
    status: "deleting",
  });
  const runningClaim = await organization({
    purgeAfter: at(-DAY),
    purgeStartedAt: at(-4 * MINUTE),
    status: "deleting",
  });

  const { purges, purgesDue } = await loadRootOpsHealthReport(db, NOW);
  const listed = ids(purges.rows);
  expect(listed).toEqual(expect.arrayContaining([overdueStart, lapsedClaim]));
  expect(listed).not.toContain(justDue);
  expect(listed).not.toContain(runningClaim);
  expect(ids(purgesDue.rows)).not.toContain(justDue);
  expect(purges.rows.find((row) => row.organizationId === lapsedClaim)).toEqual(
    {
      organizationId: lapsedClaim,
      purgeAfter: at(-DAY).toISOString(),
      purgeStartedAt: at(-6 * MINUTE).toISOString(),
      status: "deleting",
    },
  );
});

test("upcoming sections cover the next seven days, soonest first", async () => {
  const trialSoon = await organization({
    status: "trialing",
    trialEndsAt: at(6 * DAY),
  });
  const trialSooner = await organization({
    status: "trialing",
    trialEndsAt: at(DAY),
  });
  const trialLater = await organization({
    status: "trialing",
    trialEndsAt: at(8 * DAY),
  });
  const purgeSoon = await organization({
    disabledAt: at(-23 * DAY),
    purgeAfter: at(6 * DAY),
    status: "disabled",
  });
  const purgeLater = await organization({
    purgeAfter: at(8 * DAY),
    status: "disabled",
  });

  const { purgesDue, trialsEnding } = await loadRootOpsHealthReport(db, NOW);
  const trials = ids(trialsEnding.rows);
  expect(trials).toEqual(expect.arrayContaining([trialSooner, trialSoon]));
  expect(trials.indexOf(trialSooner)).toBeLessThan(trials.indexOf(trialSoon));
  expect(trials).not.toContain(trialLater);
  expect(
    purgesDue.rows.find((row) => row.organizationId === purgeSoon),
  ).toEqual({
    disabledAt: at(-23 * DAY).toISOString(),
    organizationId: purgeSoon,
    purgeAfter: at(6 * DAY).toISOString(),
  });
  expect(ids(purgesDue.rows)).not.toContain(purgeLater);
});

test("each section stops at its limit and says so", async () => {
  const later = new Date(NOW.getTime() + 365 * DAY);
  await db.insert(organizationBilling).values(
    Array.from({ length: ROOT_OPS_HEALTH_SECTION_LIMIT + 1 }, (_, index) => ({
      organizationId: randomUUID(),
      status: "trialing" as const,
      trialEndsAt: new Date(later.getTime() + (index + 1) * MINUTE),
    })),
  );

  const { trialsEnding } = await loadRootOpsHealthReport(db, later);
  expect(trialsEnding.rows).toHaveLength(ROOT_OPS_HEALTH_SECTION_LIMIT);
  expect(trialsEnding.truncated).toBe(true);
  expect(trialsEnding.rows[0]?.trialEndsAt).toBe(
    new Date(later.getTime() + MINUTE).toISOString(),
  );
});
