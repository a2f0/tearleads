import { expect, spyOn, test } from "bun:test";
import type { ApiDiagnosticOperation } from "@tearleads/diagnostics/server";
import {
  MaintenanceFailedError,
  runMaintenancePhases,
} from "./maintenancePhases";

function silenced() {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  return () => {
    log.mockRestore();
    error.mockRestore();
  };
}

test("a successful run returns every phase's summary", async () => {
  const restore = silenced();
  try {
    const summary = await runMaintenancePhases(
      [
        { name: "a", operation: "billing.purge", run: async () => ({ n: 1 }) },
        { name: "b", operation: "billing.seat-sync", run: async () => "ok" },
      ],
      () => {},
    );
    expect(summary).toEqual({ a: { n: 1 }, b: "ok" });
  } finally {
    restore();
  }
});

test("a throwing phase is reported, later phases still run, and the run rejects", async () => {
  const restore = silenced();
  const reported: [string, ApiDiagnosticOperation][] = [];
  const ran: string[] = [];
  try {
    const run = runMaintenancePhases(
      [
        {
          name: "first",
          operation: "billing.trial-expiry",
          run: async () => {
            ran.push("first");
            throw new Error("trial expiry broke");
          },
        },
        {
          name: "second",
          operation: "billing.purge",
          run: async () => {
            ran.push("second");
            return { done: true };
          },
        },
      ],
      (error, operation) => {
        reported.push([String(error), operation]);
      },
    );
    await expect(run).rejects.toBeInstanceOf(MaintenanceFailedError);
    await expect(run).rejects.toMatchObject({ failedPhases: ["first"] });
    expect(ran).toEqual(["first", "second"]);
    expect(reported).toEqual([
      ["Error: trial expiry broke", "billing.trial-expiry"],
    ]);
  } finally {
    restore();
  }
});

test("a phase whose summary counts failed items fails the run", async () => {
  const restore = silenced();
  try {
    await expect(
      runMaintenancePhases(
        [
          {
            name: "seat-sync",
            operation: "billing.seat-sync",
            run: async () => ({ attempted: 3, failed: 1, synced: 2 }),
          },
          {
            name: "purge",
            operation: "billing.purge",
            run: async () => ({ stages: { failed: 0 } }),
          },
        ],
        () => {},
      ),
    ).rejects.toMatchObject({ failedPhases: ["seat-sync"] });
  } finally {
    restore();
  }
});
