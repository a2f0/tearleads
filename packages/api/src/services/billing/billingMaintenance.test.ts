import { afterEach, expect, spyOn, test } from "bun:test";
import {
  type DatabaseTransaction,
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import type { ApiDiagnosticOperation } from "@tearleads/diagnostics/server";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import * as probeModule from "../../workflows/billing/billingMaintenanceProbe";
import { probeBillingMaintenance } from "../../workflows/billing/billingMaintenanceProbe";
import { billingMaintenancePhases } from "./billingMaintenance";
import * as purgeModule from "./organizationPurge";
import * as trialModule from "./organizationTrialExpiry";
import * as seatModule from "./stripeSeatSync";

const NOW = new Date("2031-03-04T05:06:07.000Z");
const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

class Rollback extends Error {}

async function runPhases(
  phases: Awaited<ReturnType<typeof billingMaintenancePhases>>,
) {
  const summary: Record<string, unknown> = {};
  for (const phase of phases) summary[phase.name] = await phase.run();
  return summary;
}

test("an idle billing pass is one statement", async () => {
  const counter = { statements: 0 };
  let summary: Record<string, unknown> | undefined;
  // Other files share this database, so run on emptied billing tables.
  await withEmptyBillingTables(async (tx) => {
    const runtime = createServiceTestRuntime(tx);
    summary = await withDatabaseStatementCounter(counter, async () =>
      runPhases(await billingMaintenancePhases(runtime, () => {}, NOW)),
    );
  });
  expect(counter.statements).toBe(1);
  expect(summary).toEqual({
    organizationPurge: { claimed: 0, failed: 0, purged: 0 },
    stripeSeatSync: { attempted: 0, failed: 0, synced: 0 },
    trialExpiry: { attentionRequired: 0, examined: 0, expired: 0, failed: 0 },
  });
});

/** Runs `work` on billing tables emptied inside a transaction rolled back after. */
async function withEmptyBillingTables(
  work: (tx: DatabaseTransaction) => Promise<void>,
) {
  await db
    .transaction(async (tx) => {
      await tx.delete(organizationBillingStripeSeats);
      await tx.delete(organizationBilling);
      await work(tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

test("the probe reads each phase's own candidates", async () => {
  const [trialing, disabled, deleting, seat, notDue] = Array.from(
    { length: 5 },
    () => crypto.randomUUID(),
  );
  if (!trialing || !disabled || !deleting || !seat || !notDue)
    throw new Error("Missing fixture ids");
  const past = new Date(NOW.getTime() - 1_000);
  const future = new Date(NOW.getTime() + 60_000);
  let probe: probeModule.BillingMaintenanceProbe | undefined;
  const counter = { statements: 0 };
  // Other files leave due rows behind, which would crowd these out of the
  // probe's limits.
  await withEmptyBillingTables(async (tx) => {
    await tx.insert(organizationBilling).values([
      { organizationId: trialing, status: "trialing", trialEndsAt: past },
      { organizationId: disabled, purgeAfter: past, status: "disabled" },
      { organizationId: deleting, status: "deleting" },
      { organizationId: seat, status: "active" },
      { organizationId: notDue, status: "trialing", trialEndsAt: future },
    ]);
    await tx.insert(organizationBillingStripeSeats).values({
      nextAttemptAt: past,
      organizationId: seat,
      priceId: "price_probe",
      subscriptionId: `sub_${seat}`,
      subscriptionItemId: `si_${seat}`,
    });
    probe = await withDatabaseStatementCounter(counter, () =>
      probeBillingMaintenance(tx, NOW),
    );
  });
  expect(counter.statements).toBe(1);
  expect(probe?.trialOrganizationIds).toEqual([trialing]);
  expect([...(probe?.purgeOrganizationIds ?? [])].sort()).toEqual(
    [disabled, deleting].sort(),
  );
  expect(probe?.seatSyncDue).toBe(true);
});

function stubPhases() {
  const trial = spyOn(trialModule, "expireOrganizationTrials");
  trial.mockResolvedValue({
    attentionRequired: 0,
    examined: 1,
    expired: 0,
    failed: 0,
  });
  const purge = spyOn(purgeModule, "runOrganizationPurgeMaintenance");
  purge.mockResolvedValue({ claimed: 0, failed: 0, purged: 0 });
  const seat = spyOn(seatModule, "runStripeSeatSynchronization");
  seat.mockResolvedValue({ attempted: 0, failed: 0, synced: 0 });
  restores.push(
    () => trial.mockRestore(),
    () => purge.mockRestore(),
    () => seat.mockRestore(),
  );
  return { purge, seat, trial };
}

function stubProbe(result: probeModule.BillingMaintenanceProbe | Error) {
  const probe = spyOn(probeModule, "probeBillingMaintenance");
  if (result instanceof Error) probe.mockRejectedValue(result);
  else probe.mockResolvedValue(result);
  restores.push(() => probe.mockRestore());
}

test("phases with work consume the probe and the purge reuses its rows", async () => {
  const { purge, seat, trial } = stubPhases();
  stubProbe({
    purgeOrganizationIds: ["purge-a"],
    seatSyncDue: true,
    trialOrganizationIds: ["trial-a"],
  });
  const runtime = createServiceTestRuntime();
  await runPhases(await billingMaintenancePhases(runtime, () => {}, NOW));
  expect(trial.mock.calls).toEqual([
    [runtime, { dueOrganizationIds: ["trial-a"], now: NOW }],
  ]);
  expect(purge.mock.calls).toEqual([
    [runtime, { organizationIds: ["purge-a"] }],
  ]);
  expect(seat.mock.calls).toEqual([[runtime, {}]]);
});

test("an expired trial makes the purge phase select again", async () => {
  const { purge, seat, trial } = stubPhases();
  trial.mockResolvedValue({
    attentionRequired: 0,
    examined: 1,
    expired: 1,
    failed: 0,
  });
  stubProbe({
    purgeOrganizationIds: [],
    seatSyncDue: false,
    trialOrganizationIds: ["trial-a"],
  });
  const runtime = createServiceTestRuntime();
  await runPhases(await billingMaintenancePhases(runtime, () => {}, NOW));
  expect(purge.mock.calls).toEqual([[runtime, {}]]);
  expect(seat).not.toHaveBeenCalled();
});

test("a failed probe is reported and every phase runs its own select", async () => {
  const { purge, seat, trial } = stubPhases();
  stubProbe(new Error("probe unavailable"));
  const error = spyOn(console, "error").mockImplementation(() => {});
  restores.push(() => error.mockRestore());
  const reported: ApiDiagnosticOperation[] = [];
  const runtime = createServiceTestRuntime();
  await runPhases(
    await billingMaintenancePhases(
      runtime,
      (_error, operation) => reported.push(operation),
      NOW,
    ),
  );
  expect(reported).toEqual(["billing.maintenance"]);
  expect(trial.mock.calls).toEqual([[runtime, {}]]);
  expect(purge.mock.calls).toEqual([[runtime, {}]]);
  expect(seat.mock.calls).toEqual([[runtime, {}]]);
});
