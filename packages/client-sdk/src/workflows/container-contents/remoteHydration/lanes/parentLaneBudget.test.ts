import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type {
  ListContainerParentLanesResponse,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { createSignedContainerDirectory } from "../../../../../test/helpers/data/signedContainerDirectory";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { createDomainScope } from "../../../../data/shared/domainScope";
import { containerContentsOrganizationHost } from "../../../organizations/containerContentsHost";
import { defaultContainerContentsPersistence as persistence } from "../../containerPersistence";
import { hydrateRemoteContainers } from "../index";
import type { ContainerState, RemoteContainerHydrationState } from "../types";

const timestamp = "2026-01-01T00:00:00.000Z";

function container(
  id: string,
  parentId: string | null,
): ListContainersResponse["items"][number] {
  return {
    createdAt: timestamp,
    depth: parentId ? 1 : 0,
    effectiveAccessLevel: "write",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataUpdateCount: 0,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

/** A container this device stores, as the crawl finds it in memory. */
function storedState(id: string): ContainerState {
  return {
    container: { ...container(id, null), name: id },
    doc: {},
    record: {
      accessEpoch: 1,
      accessStateHash: `access-${id}`,
      documentId: `metadata-${id}`,
      id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as unknown as ContainerState;
}

/** Serves `rows` in pages of the lane's limit, from the lane's watermark. */
function page(
  rows: ReadonlyArray<ListContainersResponse["items"][number]>,
  lane: ListContainerParentLanesRequest["lanes"][number],
): ListContainersResponse {
  const start = lane.watermark ? Number(lane.watermark.id.split(":")[1]) : 0;
  const end = Math.min(rows.length, start + (lane.limit ?? 100));
  return {
    hasMore: end < rows.length,
    items: rows.slice(start, end),
    nextWatermark: { id: `${lane.parentId}:${end}`, updatedAt: timestamp },
    tombstones: [],
  };
}

test("a full batch's lane with more children than its share continues in a later request", async () => {
  const { close, execSql } = await createTestExecSql(
    "remote-hydration-lane-budget",
  );
  // The root lane and 31 folders fill one request of 32 lanes. One folder
  // is served 16 children, one more than a lane's share of the batch's
  // 500-row page.
  const crowded = container("crowded", null);
  const others = Array.from({ length: 30 }, (_, index) => `folder-${index}`);
  const children = Array.from({ length: 16 }, (_, index) =>
    container(`child-${String(index).padStart(2, "0")}`, crowded.id),
  );
  const directory = await createSignedContainerDirectory(
    [crowded, ...children].map(
      ({ id, metadataDocumentId, organizationId, parentId }) => ({
        id,
        metadataDocumentId,
        organizationId,
        parentId,
      }),
    ),
  );
  try {
    await persistence.ensureSchema(execSql);
    const containersById = new Map<string, ContainerState>();
    for (const id of others) {
      const stored = storedState(id);
      containersById.set(id, stored);
      await persistence.saveContainer(execSql, stored.container, stored.record);
    }
    let childrenServed = false;
    const requests: ListContainerParentLanesRequest[] = [];
    const rowsOf = (parentId: string | null) => {
      if (parentId === null) return [crowded];
      return parentId === crowded.id && childrenServed ? children : [];
    };
    const state = {
      containersById,
      persistence,
      runtime: withPrincipalPolicies({
        organizations: containerContentsOrganizationHost,
        resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
        apiClient: {
          evictContainerWriterProjection: () => {},
          getContainerWriterProjection: directory.getContainerWriterProjection,
          getCurrentPrincipalPolicy: async () => null,
          listContainerParentLanes: async (
            request: ListContainerParentLanesRequest,
          ): Promise<ListContainerParentLanesResponse> => {
            requests.push(request);
            return {
              results: request.lanes.map((lane) => ({
                laneId: lane.laneId,
                page: page(rowsOf(lane.parentId), lane),
              })),
            };
          },
        },
        auth: { isAuthenticated: true },
        infra: { dbStatus: "ready", execSql },
        state: { domainScope: createDomainScope(), online: true },
        util: { log: () => {} },
      }),
    } as unknown as RemoteContainerHydrationState;
    const crawl = () =>
      hydrateRemoteContainers({
        host: {
          persistContainerState: async () => {
            throw new Error("The crawls update no stored container");
          },
          updateSnapshot: () => {},
        },
        parentIds: [null, crowded.id, ...others],
        state,
      });
    // An earlier crawl stored the crowded folder, before its children.
    await crawl();
    expect(state.containersById.has(crowded.id)).toBe(true);
    requests.length = 0;

    childrenServed = true;
    await crawl();

    // The crowded lane continues beside the lanes of the children it was
    // served, at their larger share, and the last child's lane follows.
    expect(
      requests.map(({ lanes }) => [lanes.length, lanes[0]?.limit ?? null]),
    ).toEqual([
      [32, 15],
      [16, 31],
      [1, 100],
    ]);
    expect(
      requests[1]?.lanes.map(({ parentId, watermark }) =>
        parentId === crowded.id ? `continues from ${watermark?.id}` : parentId,
      ),
    ).toEqual([
      ...children.slice(0, 15).map(({ id }) => id),
      "continues from crowded:15",
    ]);
    expect(children.every(({ id }) => state.containersById.has(id))).toBe(true);
  } finally {
    await close();
  }
});
