import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerParentLaneBatchMock as batchParentLanes,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { ListContainersResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import {
  listDormantMetadataSweepRequests,
  requestDormantMetadataRestorationSweep,
} from "../../data/persistence/container-contents/dormantMetadataSweep";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";

const ORGANIZATION_ID = "restored-organization";

function emptyContainerPage(): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

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
    [containerId],
    { retainMetadataForContainerIds: [containerId] },
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

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
    await requestDormantMetadataRestorationSweep(execSql, {
      organizationId: ORGANIZATION_ID,
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
        return failHydration ? null : emptyContainerPage();
      }),
    });
    const runtime = createContainerContentsStoreTestRuntime({
      apiClient,
      auth: {
        isAuthenticated: true,
        organizationId: ORGANIZATION_ID,
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: {} as BlobStore,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: null,
        domainScope,
        events: [],
        online: true,
      },
      util: { log: () => {} },
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => hydrationRequests > 0,
      "Restoration did not request a recursive hydration.",
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

    failHydration = false;
    store.requestSync();
    await waitFor(
      () => hydrationRequests > hydrationRequestsAfterFailure,
      "Restoration hydration was not retryable.",
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
    await waitForDomainSyncCoordinatorToSettle(domainScope);
    expect(hydrationRequests).toBe(hydrationRequestsAfterAmbiguousProbe);

    retryProbeStatus = 404;
    store.requestSync();
    await waitFor(
      () => hydrationRequests > hydrationRequestsAfterAmbiguousProbe,
      "Deferred restoration probe was not retryable.",
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
