import { expect, test } from "bun:test";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import type { RemoteHydrationRefreshOptions } from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

test("reset recovery forces only the sweep interrupted by the stale generation", async () => {
  const interruptedSweep = {
    attemptCount: 0,
    generation: 1,
    lastAttemptedAt: null,
    organizationId: "organization-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
    requesterUserId: "user-1",
  };
  const interruptedSweepInBackoff = {
    ...interruptedSweep,
    attemptCount: 1,
    lastAttemptedAt: new Date().toISOString(),
  };
  const unrelatedSweepInBackoff = {
    ...interruptedSweepInBackoff,
    attemptCount: 3,
    generation: 2,
    organizationId: "organization-2",
  };
  const claimedOrganizations: string[] = [];
  let requestListCount = 0;
  let recreateCompletion: RemoteHydrationRefreshOptions["recreateOnFullyHydratedAfterReset"];
  const execSql = async () => [];
  const persistence = {
    claimDormantMetadataSweepAttempt: async (
      _execSql: unknown,
      sweep: typeof interruptedSweep,
    ) => {
      claimedOrganizations.push(sweep.organizationId);
      return true;
    },
    completeDormantMetadataSweepRequest: async () => {},
    listDormantMetadataSweepCandidates: async () => [],
    listDormantMetadataSweepRequests: async () => {
      requestListCount += 1;
      return requestListCount === 1
        ? [interruptedSweep]
        : [interruptedSweepInBackoff, unrelatedSweepInBackoff];
    },
    purgeDormantContainerMetadataCandidates: async () => 0,
  };
  const state = {
    containerParentIdsNeedingHydration: new Set(),
    containersById: new Map(),
    initialized: true,
    lifecycleGeneration: 0,
    persistence,
    remoteHydrationPromise: null,
    runtime: {
      auth: { isAuthenticated: true, userId: "user-1" },
      infra: { dbStatus: "ready", execSql },
      state: { online: true },
      util: { log: () => {} },
    },
    structuralGeneration: 0,
  } as unknown as ContainerContentsStoreSyncState;
  const reconcile = createRestoredAccessReconciler({
    requestHydration: async (options) => {
      recreateCompletion = options.recreateOnFullyHydratedAfterReset;
    },
    state,
  });

  await reconcile();
  expect(claimedOrganizations).toEqual(["organization-1"]);

  state.lifecycleGeneration += 1;
  const completion = recreateCompletion?.();
  expect(completion).toBeDefined();
  await completion?.();

  expect(claimedOrganizations).toEqual(["organization-1", "organization-1"]);
});
