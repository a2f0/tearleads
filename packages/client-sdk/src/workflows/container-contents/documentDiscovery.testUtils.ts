import type { DiscoveredDocumentCandidate } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { upsertAccessManifestCheckpointInTransaction } from "../../data/persistence/keyingCheckpointPersistence";
import { keyingCheckpointTables } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../data/sqlite/sqlSchema";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentPlacement,
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  ListContainersResponse,
} from "./documentDiscoveryTypes";

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
