import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../../data/domainScope";
import {
  listDormantMetadataSweepRequests,
  requestDormantMetadataRestorationSweeps,
} from "../../data/persistence/container-contents/dormantMetadataSweep";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createRestoredAccessReconciler } from "./accessRestorationSweep";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  emptyListContainersResponse,
} from "./runtime.testFixtures";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

const ORGANIZATION_ID = "restored-organization";
async function countMetadataDocuments(
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.ensureSchema
  >[0],
  containerId: string,
): Promise<number> {
  const rows = await execSql(
    `SELECT COUNT(*) AS n FROM documents
     WHERE app_kind = 'container-metadata' AND local_id = ?`,
    [containerId],
  );
  return Number(Reflect.get(rows[0] ?? {}, "n") ?? 0);
}

async function seedDormantMetadata(
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.ensureSchema
  >[0],
  containerId: string,
): Promise<void> {
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "write",
      icon: null,
      id: containerId,
      metadataDocumentId: `metadata-${containerId}`,
      name: "Revoked",
      organizationId: ORGANIZATION_ID,
      parentId: null,
    },
    {
      accessEpoch: 1,
      documentId: `metadata-${containerId}`,
      id: containerId,
      metadataUpdates: "c2VlZA==",
      snapshotEndVersion: "",
    },
  );
  await defaultContainerContentsPersistence.deleteContainers(
    execSql,
    [
      {
        containerId,
        reason: "access_revoked",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    { retainMetadataForContainerIds: [containerId] },
  );
}

async function makeRestorationSweepRetryDue(
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.ensureSchema
  >[0],
): Promise<void> {
  await execSql(
    `UPDATE dormant_metadata_sweep_requests
     SET last_attempted_at = '2000-01-01T00:00:00.000Z'`,
  );
}

test("restoration failures do not reject the structural sync pass", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-access-restoration-error-isolation",
  );
  const loggedErrors: unknown[] = [];
  try {
    const reconcile = createRestoredAccessReconciler({
      requestHydration: async () => {
        throw new Error("hydration must not run");
      },
      state: {
        persistence: {
          listDormantMetadataSweepRequests: async () => {
            throw new Error("sweep storage unavailable");
          },
        },
        runtime: {
          auth: { userId: "user-1" },
          infra: { execSql },
          util: {
            log: () => {},
            logError: (_message: string | Error, error?: unknown) => {
              loggedErrors.push(error);
            },
          },
        },
      } as unknown as ContainerContentsStoreSyncState,
    });

    await expect(reconcile()).resolves.toBeUndefined();
    expect(loggedErrors).toHaveLength(1);
  } finally {
    await close();
  }
});

test("a structural generation change cancels restoration before claiming sweeps", async () => {
  const sweep = {
    attemptCount: 0,
    generation: 1,
    lastAttemptedAt: null,
    organizationId: ORGANIZATION_ID,
    requestedAt: "2026-01-01T00:00:00.000Z",
    requesterUserId: "user-1",
  };
  let current = true;
  let releaseRequests: (sweeps: readonly (typeof sweep)[]) => void = () => {
    throw new Error("sweep request promise was not initialized");
  };
  let requestLoadStarted = false;
  let claimCount = 0;
  let hydrationCount = 0;
  const state = {
    lifecycleGeneration: 0,
    persistence: {
      claimDormantMetadataSweepAttempt: async () => {
        claimCount += 1;
        return true;
      },
      listDormantMetadataSweepRequests: () => {
        requestLoadStarted = true;
        return new Promise<readonly (typeof sweep)[]>((resolve) => {
          releaseRequests = resolve;
        });
      },
    },
    runtime: {
      auth: { userId: "user-1" },
      infra: { execSql: {} },
      util: { log: () => {} },
    },
  } as unknown as ContainerContentsStoreSyncState;
  const reconcile = createRestoredAccessReconciler({
    requestHydration: async () => {
      hydrationCount += 1;
    },
    state,
  });

  const restoration = reconcile(() => current);
  await waitFor(
    () => requestLoadStarted,
    "Restoration did not start loading sweep requests.",
  );
  current = false;
  releaseRequests([sweep]);
  await restoration;

  expect(claimCount).toBe(0);
  expect(hydrationCount).toBe(0);
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

test("restoration sweep waits for a complete recursive hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-access-restoration-sweep",
  );
  const domainScope = createDomainScope();
  let failHydration = true;
  let hydrationRequests = 0;
  let retryProbeStatus = 503;
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await seedDormantMetadata(execSql, "revoked");
    await seedDormantMetadata(execSql, "still-revoked");
    await seedDormantMetadata(execSql, "retry-probe");
    await requestDormantMetadataRestorationSweeps(execSql, {
      requesterUserId: "user-1",
    });

    const apiClient = createMockApiClient({
      getContainerWriterProjectionResult: async (containerId) => {
        const status =
          containerId === "revoked"
            ? 404
            : containerId === "still-revoked"
              ? 403
              : retryProbeStatus;
        return {
          kind: "http" as const,
          message: `GET projection failed with ${status}`,
          method: "GET" as const,
          ok: false as const,
          path: `/containers/${containerId}/writer-projection`,
          report: () => {},
          status,
          statusText: status === 404 ? "Not Found" : "Forbidden",
        };
      },
      listContainerParentLanes: batchParentLanes(async () => {
        hydrationRequests += 1;
        return failHydration ? null : emptyListContainersResponse();
      }),
    });
    const runtime = createContainerContentsTestRuntime({
      apiClient,
      domainScope,
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      execSql,
      organizationId: ORGANIZATION_ID,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => hydrationRequests > 0,
      "Restoration did not request a recursive hydration.",
      2_000,
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    const hydrationRequestsAfterFailure = hydrationRequests;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(hydrationRequests).toBe(hydrationRequestsAfterFailure);
    expect(await countMetadataDocuments(execSql, "revoked")).toBe(1);
    expect(await countMetadataDocuments(execSql, "still-revoked")).toBe(1);
    expect(await countMetadataDocuments(execSql, "retry-probe")).toBe(1);
    expect(
      await listDormantMetadataSweepRequests(execSql, "user-1"),
    ).toHaveLength(1);

    store.requestSync();
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(hydrationRequests).toBe(hydrationRequestsAfterFailure);

    await makeRestorationSweepRetryDue(execSql);
    failHydration = false;
    store.requestSync();
    await waitFor(
      () => hydrationRequests > hydrationRequestsAfterFailure,
      "Restoration hydration was not retryable.",
      2_000,
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(hydrationRequests).toBeGreaterThan(hydrationRequestsAfterFailure);
    expect(await countMetadataDocuments(execSql, "revoked")).toBe(0);
    expect(await countMetadataDocuments(execSql, "still-revoked")).toBe(1);
    expect(await countMetadataDocuments(execSql, "retry-probe")).toBe(1);
    expect(
      await listDormantMetadataSweepRequests(execSql, "user-1"),
    ).toHaveLength(1);

    const hydrationRequestsAfterAmbiguousProbe = hydrationRequests;
    await new Promise((resolve) => setTimeout(resolve, 25));
    store.requestSync();
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(hydrationRequests).toBe(hydrationRequestsAfterAmbiguousProbe);

    await execSql(
      `UPDATE dormant_metadata_sweep_requests
       SET attempt_count = 4,
           last_attempted_at = '2000-01-01T00:00:00.000Z'`,
    );
    store.requestSync();
    await waitFor(
      () => hydrationRequests > hydrationRequestsAfterAmbiguousProbe,
      "Final bounded restoration probe was not attempted.",
      2_000,
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(await countMetadataDocuments(execSql, "retry-probe")).toBe(1);
    expect(await listDormantMetadataSweepRequests(execSql, "user-1")).toEqual(
      [],
    );

    const hydrationRequestsAfterExhaustion = hydrationRequests;
    await requestDormantMetadataRestorationSweeps(execSql, {
      requesterUserId: "user-1",
    });
    retryProbeStatus = 404;
    store.requestSync();
    await waitFor(
      () => hydrationRequests > hydrationRequestsAfterExhaustion,
      "A new restoration edge did not reset the bounded probe budget.",
      2_000,
    );
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(await countMetadataDocuments(execSql, "retry-probe")).toBe(0);
    expect(await countMetadataDocuments(execSql, "still-revoked")).toBe(1);
    expect(await listDormantMetadataSweepRequests(execSql, "user-1")).toEqual(
      [],
    );
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    await close();
  }
});
