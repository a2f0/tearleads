import { expect, test } from "bun:test";
import { type Logger, Tearleads } from "./client";
import { getOrCreateDomainSyncCoordinator } from "./data/sync/syncCoordinator";

const quietLogger: Required<Logger> = {
  log: () => undefined,
  logError: () => undefined,
};

test("dispose() force-stops the active scope's coordinator and drops it", async () => {
  const sdk = new Tearleads({ logger: quietLogger, online: false });
  // Touch device-first so a reconciler exists for the scope; dispose() must
  // stop it without throwing in addition to tearing down the coordinator.
  sdk.deviceFirst.reconciler();

  const scope = sdk.domainScope;
  const coordinator = getOrCreateDomainSyncCoordinator(scope);
  let ran = 0;
  const lane = coordinator.registerLane("dispose-probe", {
    run: async () => {
      ran += 1;
    },
  });

  sdk.dispose();

  // The disposed coordinator ignores new requests — no pump can resurrect it.
  lane.requestSync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ran).toBe(0);

  // It was dropped from the registry: the same scope now yields a fresh
  // coordinator (the React-remount path), not the disposed one.
  expect(getOrCreateDomainSyncCoordinator(scope)).not.toBe(coordinator);
});
