import type { SyncWatermark } from "@tearleads/validators/response";
import type { DiscoveredDocumentCandidate } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { upsertAccessManifestCheckpointInTransaction } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { keyingCheckpointTables } from "../../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentLaneLister,
  ContainerDocumentPlacement,
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  ListContainerDocumentsResponse,
  ListContainersResponse,
} from "./documentDiscoveryTypes";

/** A per-container page mock; `null` rejects that container's lane. */
export type ContainerDocumentPageMock = (
  containerId: string,
  options: { readonly watermark: SyncWatermark | null },
) => Promise<ListContainerDocumentsResponse | null>;

/** Serves each lane of a batched listing from a per-container mock, in order. */
export function laneLister(
  list: ContainerDocumentPageMock,
): ContainerDocumentLaneLister {
  return async (lanes) => {
    const pages: Array<ListContainerDocumentsResponse | null> = [];
    for (const lane of lanes) {
      pages.push(await list(lane.containerId, { watermark: lane.watermark }));
    }
    return pages;
  };
}

/** The batched API over a per-container mock; `null` becomes a lane failure. */
export function laneApi(
  list: ContainerDocumentPageMock,
): Pick<ContainerDocumentDiscoveryApi, "listContainerDocumentLanes"> {
  return {
    listContainerDocumentLanes: async ({ lanes }) => {
      const pages = await laneLister(list)(lanes);
      if (!pages) return null;
      return {
        results: lanes.map(({ laneId }, index) => {
          const page = pages[index];
          return page ? { laneId, page } : { failure: {}, laneId };
        }),
      };
    },
  };
}

/** Listing items and tombstones are trusted here; no pending evidence is stored. */
export const trustedContainerDocumentTombstones = {
  beginDocumentDiscovery: async () => 1,
  verifyDiscoveredDocuments: async (
    inputs: ReadonlyArray<DiscoveredDocumentCandidate>,
  ) => ({
    inputs: inputs.map(({ listedContainerIds: _listed, ...input }) => input),
    isCurrent: async () => true,
    commit: async () => true,
  }),
  holdContainerDocumentTombstones: async () => {},
  listHeldContainerDocumentTombstones: async () => [],
  listKnownContainerDocumentPlacements: async (
    placements: ReadonlyArray<ContainerDocumentPlacement>,
  ) => placements,
  refuteContainerDocumentTombstoneHolds: async () => {},
  verifyContainerDocumentTombstones: async (
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ): Promise<ContainerDocumentTombstoneVerdict[]> =>
    tombstones.map((tombstone) => ({
      kind: "verified",
      tombstone: {
        ...tombstone,
        accessEpoch: Number.MAX_SAFE_INTEGER,
        linkedContainerIds: [],
      },
    })),
};

export const nullContainerDocumentWatermarks = {
  ...trustedContainerDocumentTombstones,
  applyContainerDocumentTombstones: async () => [],
  loadContainerDocumentWatermark: async () => null,
  saveContainerDocumentWatermark: async () => {},
};

type DiscoveryParentLaneRequest = Parameters<
  ContainerDocumentDiscoveryApi["listContainerParentLanes"]
>[0]["lanes"][number];

export function createDiscoveryParentLaneBatchMock(
  resolveLane: (
    input: Omit<DiscoveryParentLaneRequest, "laneId">,
  ) => Promise<ListContainersResponse | null>,
  onBatch?:
    | ((lanes: ReadonlyArray<DiscoveryParentLaneRequest>) => void)
    | undefined,
): ContainerDocumentDiscoveryApi["listContainerParentLanes"] {
  return async ({ lanes }) => {
    onBatch?.(lanes);
    const pages = await Promise.all(
      lanes.map(({ laneId: _laneId, ...lane }) => resolveLane(lane)),
    );
    const results = [];
    for (const [index, lane] of lanes.entries()) {
      const page = pages[index];
      if (!page) {
        return null;
      }
      results.push({ laneId: lane.laneId, page });
    }
    return { results };
  };
}

export async function pinTestDiscoveryHead(
  execSql: ExecSql,
  documentId: string,
  manifestHash: string,
) {
  await ensureSqlTables(execSql, keyingCheckpointTables);
  await upsertAccessManifestCheckpointInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      objectKind: "document",
      organizationId: "org",
      objectId: documentId,
      epoch: 1,
      manifestHash,
    },
    "2026-09-23T00:00:00.000Z",
  );
}
