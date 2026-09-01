import { expect, test } from "bun:test";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../../test/helpers/clientTestSupport";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { getOrCreateDomainSyncCoordinator } from "../data/sync/syncCoordinator";
import { Tearleads } from ".";

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

test("dispose() tears down reconcilers/coordinators across all scopes", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
    online: false,
  });
  sdk.deviceFirst.reconciler();
  const scopeA = sdk.domainScope;
  const coordinatorA = getOrCreateDomainSyncCoordinator(scopeA);

  // Rotate the domain scope (anonymous -> authenticated) and create a second
  // reconciler so dispose() must tear down more than the current scope.
  await setGeneratedIdentity(sdk.identity);
  sdk.deviceFirst.reconciler();
  const scopeB = sdk.domainScope;
  expect(scopeB).not.toBe(scopeA);
  const coordinatorB = getOrCreateDomainSyncCoordinator(scopeB);

  let ranA = 0;
  let ranB = 0;
  const laneA = coordinatorA.registerLane("probe-a", {
    run: async () => {
      ranA += 1;
    },
  });
  const laneB = coordinatorB.registerLane("probe-b", {
    run: async () => {
      ranB += 1;
    },
  });

  sdk.dispose();

  laneA.requestSync();
  laneB.requestSync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ranA).toBe(0);
  expect(ranB).toBe(0);
  expect(getOrCreateDomainSyncCoordinator(scopeA)).not.toBe(coordinatorA);
  expect(getOrCreateDomainSyncCoordinator(scopeB)).not.toBe(coordinatorB);
});
