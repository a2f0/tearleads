import { expect, test } from "bun:test";
import { CONTAINER_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { waitFor } from "../../../test/helpers/waitFor";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import type { RemoteHydrationRefreshOptions } from "./remoteHydrationRefresh";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

const ORGANIZATION_ID = "restored-organization";

test("reset recovery resumes the claimed final attempt without consuming another", async () => {
  const interruptedSweep = {
    attemptCount: 4,
    generation: 1,
    lastAttemptedAt: null,
    organizationId: "organization-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
    requesterUserId: "user-1",
  };
  const interruptedSweepInBackoff = {
    ...interruptedSweep,
    attemptCount: 5,
    lastAttemptedAt: new Date().toISOString(),
  };
  const unrelatedSweepInBackoff = {
    ...interruptedSweepInBackoff,
    attemptCount: 3,
    generation: 2,
    organizationId: "organization-2",
  };
  const claimedOrganizations: string[] = [];
  const completedOrganizations: string[] = [];
  const probedOrganizations: string[] = [];
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
    completeDormantMetadataSweepRequest: async (
      _execSql: unknown,
      sweep: typeof interruptedSweep,
    ) => {
      completedOrganizations.push(sweep.organizationId);
    },
    listDormantMetadataSweepCandidates: async (
      _execSql: unknown,
      sweep: typeof interruptedSweep,
    ) => {
      probedOrganizations.push(sweep.organizationId);
      return [];
    },
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

  expect(claimedOrganizations).toEqual(["organization-1"]);
  expect(probedOrganizations).toEqual(["organization-1"]);
  expect(completedOrganizations).toEqual(["organization-1"]);
});

test("reset reloads and claims restoration cleanup in the replacement generation", async () => {
  const staleExecSql = {};
  const recoveredExecSql = {};
  const staleSweep = {
    attemptCount: 0,
    generation: 1,
    lastAttemptedAt: null,
    organizationId: ORGANIZATION_ID,
    requestedAt: "2026-01-01T00:00:00.000Z",
    requesterUserId: "user-1",
  };
  const recoveredSweep = {
    ...staleSweep,
    generation: 2,
    organizationId: "organization-2",
    requesterUserId: "user-2",
  };
  let candidateLoadStarted = false;
  let resolveCandidates: (containerIds: readonly string[]) => void = () => {
    throw new Error("candidate promise was not initialized");
  };
  const staleCandidateExecSql: unknown[] = [];
  const recoveredCandidateExecSql: unknown[] = [];
  const claimedSweeps: unknown[] = [];
  const requestedSweepUsers: string[] = [];
  let recoveredCandidateLoadCount = 0;
  let recoveredCompletionCount = 0;
  let recreateCompletionAfterReset:
    | (() => () => Promise<void> | void)
    | undefined;
  const purgedSweeps: unknown[] = [];
  let recoveredProjectionProbeCount = 0;
  let staleProjectionProbeCount = 0;
  const stalePersistence = {
    claimDormantMetadataSweepAttempt: async () => true,
    completeDormantMetadataSweepRequest: async () => {
      throw new Error("the stale sweep must not complete");
    },
    listDormantMetadataSweepCandidates: (execSql: unknown) => {
      staleCandidateExecSql.push(execSql);
      candidateLoadStarted = true;
      return new Promise<readonly string[]>((resolve) => {
        resolveCandidates = resolve;
      });
    },
    listDormantMetadataSweepRequests: async () => [staleSweep],
    purgeDormantContainerMetadataCandidates: async () => {
      throw new Error("the stale sweep must not purge metadata");
    },
  };
  const state = {
    containerParentIdsNeedingHydration: new Set(),
    containersById: new Map(),
    initialized: true,
    lifecycleGeneration: 0,
    persistence: stalePersistence,
    remoteHydrationPromise: null,
    runtime: {
      apiClient: {
        evictContainerWriterProjection: () => {},
        getContainerWriterProjectionResult: async () => {
          staleProjectionProbeCount += 1;
          return {
            code: CONTAINER_NOT_FOUND_ERROR_CODE,
            kind: "http" as const,
            message: "missing",
            method: "GET" as const,
            ok: false as const,
            path: "/containers/container-1/writer-projection",
            report: () => {},
            status: 404,
            statusText: "Not Found",
          };
        },
      },
      auth: { isAuthenticated: true, userId: "user-1" },
      infra: { dbStatus: "ready", execSql: staleExecSql },
      state: { online: true },
      util: { log: () => {} },
    },
    structuralGeneration: 0,
  } as unknown as ContainerContentsStoreSyncState;
  const reconcile = createRestoredAccessReconciler({
    requestHydration: async (options) => {
      recreateCompletionAfterReset = options.recreateOnFullyHydratedAfterReset;
      await options.onFullyHydrated?.();
    },
    state,
  });

  const restoration = reconcile();
  await waitFor(
    () => candidateLoadStarted,
    "Restoration cleanup did not start loading candidates.",
    2_000,
  );
  state.lifecycleGeneration = 1;
  state.structuralGeneration = 1;
  state.persistence = {
    claimDormantMetadataSweepAttempt: async (
      _execSql: unknown,
      sweep: unknown,
    ) => {
      claimedSweeps.push(sweep);
      return true;
    },
    completeDormantMetadataSweepRequest: async () => {
      recoveredCompletionCount += 1;
    },
    listDormantMetadataSweepCandidates: (execSql: unknown, sweep: unknown) => {
      recoveredCandidateExecSql.push(execSql);
      expect(sweep).toEqual({
        ...recoveredSweep,
        attemptCount: 1,
        lastAttemptedAt: expect.any(String),
      });
      recoveredCandidateLoadCount += 1;
      return Promise.resolve(
        recoveredCandidateLoadCount === 1 ? ["container-1"] : [],
      );
    },
    listDormantMetadataSweepRequests: async (
      _execSql: unknown,
      requesterUserId: string,
    ) => {
      requestedSweepUsers.push(requesterUserId);
      return [recoveredSweep];
    },
    purgeDormantContainerMetadataCandidates: async (
      _execSql: unknown,
      sweep: unknown,
    ) => {
      purgedSweeps.push(sweep);
      return 1;
    },
  } as never;
  state.runtime = {
    apiClient: {
      evictContainerWriterProjection: () => {},
      getContainerWriterProjectionResult: async () => {
        recoveredProjectionProbeCount += 1;
        return {
          code: CONTAINER_NOT_FOUND_ERROR_CODE,
          kind: "http" as const,
          message: "missing",
          method: "GET" as const,
          ok: false as const,
          path: "/containers/container-1/writer-projection",
          report: () => {},
          status: 404,
          statusText: "Not Found",
        };
      },
    },
    auth: { isAuthenticated: true, userId: "user-2" },
    infra: { dbStatus: "ready", execSql: recoveredExecSql },
    state: { online: true },
    util: { log: () => {} },
  } as never;
  resolveCandidates(["container-1"]);
  await restoration;
  expect(staleCandidateExecSql).toEqual([staleExecSql]);
  expect(staleProjectionProbeCount).toBe(0);
  expect(recoveredProjectionProbeCount).toBe(0);

  const retryCompletion = recreateCompletionAfterReset?.();
  expect(retryCompletion).toBeDefined();
  await retryCompletion?.();

  expect(requestedSweepUsers).toEqual(["user-2"]);
  expect(claimedSweeps).toEqual([recoveredSweep]);
  expect(recoveredCandidateExecSql).toEqual([
    recoveredExecSql,
    recoveredExecSql,
  ]);
  expect(recoveredProjectionProbeCount).toBe(1);
  expect(purgedSweeps).toEqual([
    {
      ...recoveredSweep,
      attemptCount: 1,
      lastAttemptedAt: expect.any(String),
    },
  ]);
  expect(recoveredCompletionCount).toBe(1);
});
