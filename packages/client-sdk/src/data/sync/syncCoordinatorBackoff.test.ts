import { expect, spyOn, test } from "bun:test";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import { createDomainScope } from "../shared/domainScope";
import { getOrCreateDomainSyncCoordinator } from "./syncCoordinator";

for (const phase of ["document", "structural"] as const) {
  test(`${phase} backoff expires independently of wall-clock progress`, async () => {
    const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now);
    const calls: string[] = [];
    let attempts = 0;
    const failing = coordinator.registerLane("retry", {
      phase,
      onUnexpectedError: () => {},
      run: async () => {
        calls.push(`retry-${++attempts}`);
        if (attempts === 1) {
          failing.requestSync();
          throw new Error("transient");
        }
      },
    });
    const healthy = coordinator.registerLane("healthy", {
      run: async () => {
        calls.push("healthy");
      },
    });
    try {
      failing.requestSync();
      healthy.requestSync();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toEqual(
        phase === "structural" ? ["retry-1"] : ["retry-1", "healthy"],
      );
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(attempts).toBe(2);
      expect(calls).toEqual(
        phase === "structural"
          ? ["retry-1", "retry-2", "healthy"]
          : ["retry-1", "healthy", "retry-2"],
      );
    } finally {
      clock.mockRestore();
      coordinator.dispose();
    }
  });
}

test("a lane refused as busy retries automatically without a follow-up request or error count", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  const reported: unknown[] = [];
  const unexpected: unknown[] = [];
  let attempts = 0;
  const lane = coordinator.registerLane("busy-lane", {
    onUnexpectedError: (error) => unexpected.push(error),
    reportUnexpectedError: (error) => reported.push(error),
    run: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Failed query", {
          cause: new Error(DATABASE_TRANSACTION_BUSY_MESSAGE),
        });
      }
    },
  });
  try {
    lane.requestSync();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(attempts).toBe(1);
    const mid = coordinator
      .getSnapshot()
      .lanes.find((entry) => entry.key === "busy-lane");
    expect(mid).toMatchObject({
      errorCount: 0,
      lastError: null,
      requested: true,
      status: "queued",
    });

    await new Promise((resolve) => setTimeout(resolve, 1_150));
    expect(attempts).toBe(2);
    const settled = coordinator
      .getSnapshot()
      .lanes.find((entry) => entry.key === "busy-lane");
    expect(settled).toMatchObject({
      errorCount: 0,
      lastError: null,
      status: "complete",
    });
    expect(reported).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    coordinator.dispose();
  }
});
