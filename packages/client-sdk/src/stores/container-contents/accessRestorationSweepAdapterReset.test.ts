import { expect, test } from "bun:test";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import type { RemoteHydrationRefreshOptions } from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

const sweep = {
  attemptCount: 0,
  generation: 1,
  lastAttemptedAt: null,
  organizationId: "organization-1",
  requestedAt: "2026-01-01T00:00:00.000Z",
  requesterUserId: "user-1",
};

test("adapter replacement resumes a claimed sweep on the same database", async () => {
  const execSql = {};
  let recreateCompletion:
    | RemoteHydrationRefreshOptions["recreateOnFullyHydratedAfterReset"]
    | undefined;
  const initialPersistence = {
    claimDormantMetadataSweepAttempt: async () => true,
    listDormantMetadataSweepRequests: async () => [sweep],
  };
  let candidateLoads = 0;
  let completionCount = 0;
  let purgeCount = 0;
  const replacementPersistence = {
    claimDormantMetadataSweepAttempt: async () => {
      throw new Error("the already-claimed attempt must not be claimed again");
    },
    completeDormantMetadataSweepRequest: async () => {
      completionCount += 1;
    },
    listDormantMetadataSweepCandidates: async () => {
      candidateLoads += 1;
      return candidateLoads === 1 ? ["deleted-container"] : [];
    },
    listDormantMetadataSweepRequests: async () => [
      {
        ...sweep,
        attemptCount: 1,
        lastAttemptedAt: new Date().toISOString(),
      },
    ],
    purgeDormantContainerMetadataCandidates: async () => {
      purgeCount += 1;
      return 1;
    },
  };
  const state = {
    containerParentIdsNeedingHydration: new Set(),
    containersById: new Map(),
    initialized: true,
    lifecycleGeneration: 0,
    persistence: initialPersistence,
    remoteHydrationPromise: null,
    runtime: {
      apiClient: {
        evictContainerWriterProjection: () => undefined,
        getContainerWriterProjectionResult: async () => ({
          code: CONTAINER_NOT_FOUND_ERROR_CODE,
          kind: "http" as const,
          message: "missing",
          method: "GET" as const,
          ok: false as const,
          path: "/containers/deleted-container/writer-projection",
          report: () => undefined,
          status: 404,
          statusText: "Not Found",
        }),
      },
      auth: { isAuthenticated: true, userId: "user-1" },
      infra: { dbStatus: "ready", execSql },
      state: { online: true },
      util: { log: () => undefined },
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
  expect(recreateCompletion).toBeDefined();
  state.lifecycleGeneration = 1;
  state.structuralGeneration = 1;
  state.persistence = replacementPersistence as never;

  await recreateCompletion?.()();

  expect(candidateLoads).toBe(2);
  expect(purgeCount).toBe(1);
  expect(completionCount).toBe(1);
});
