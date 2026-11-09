import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../shared/domainScope";
import { getOrCreateDomainSyncCoordinator } from "./syncCoordinator";
import type { SyncPass } from "./syncLaneConfig";

test("one drain hands every run the same pass; the next drain gets a fresh one", async () => {
  const coordinator = getOrCreateDomainSyncCoordinator(createDomainScope());
  let releaseFirst = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const passes: { lane: string; pass: SyncPass }[] = [];
  let firstRuns = 0;
  const first = coordinator.registerLane("doc-first", {
    run: async (pass) => {
      passes.push({ lane: "first", pass });
      firstRuns += 1;
      if (firstRuns === 1) {
        // A follow-up requested mid-run joins the same drain.
        first.requestSync();
        await firstHeld;
      }
    },
  });
  const second = coordinator.registerLane("doc-second", {
    run: async (pass) => {
      passes.push({ lane: "second", pass });
    },
  });
  try {
    first.requestSync();
    await waitFor(() => passes.length === 1, "first lane did not start");
    // Concurrent with the held first run.
    second.requestSync();
    await waitFor(() => passes.length === 2, "second lane did not start");
    releaseFirst();
    expect(await coordinator.waitForIdle({ timeoutMs: 2000 })).toBe(true);
    expect(passes.map(({ lane }) => lane)).toEqual([
      "first",
      "second",
      "first",
    ]);
    const drainPass = passes[0]?.pass;
    if (!drainPass) throw new Error("the drain handed out no pass");
    for (const { pass } of passes) expect(pass).toBe(drainPass);

    // The pump went idle, so its pass died with that drain.
    second.requestSync();
    expect(await coordinator.waitForIdle({ timeoutMs: 2000 })).toBe(true);
    expect(passes).toHaveLength(4);
    expect(passes[3]?.pass).not.toBe(drainPass);
  } finally {
    releaseFirst();
    coordinator.dispose();
  }
});
