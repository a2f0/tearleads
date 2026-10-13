import { expect, spyOn, test } from "bun:test";
import { createDomainScope } from "../domainScope";
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
