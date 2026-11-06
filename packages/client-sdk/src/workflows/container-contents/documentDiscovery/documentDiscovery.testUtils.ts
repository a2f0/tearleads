import type { SyncWatermark } from "@tearleads/validators/response";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import type { DiscoveredDocumentCandidate } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { upsertAccessManifestCheckpointInTransaction } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { keyingCheckpointTables } from "../../../data/sqlite/schema/keyingCheckpointSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import { discoverContainerDocumentLanes } from "./documentDiscoveryLanes";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentLaneLister,
  ContainerDocumentPlacement,
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  DiscoverContainerDocumentsOptions,
  ListContainerDocumentsResponse,
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

/** Runs the production lane path for one container, rethrowing its rejection. */
export async function discoverContainerDocuments({
  beginDocumentDiscovery,
  listContainerDocumentLanes,
  loadContainerDocumentWatermark,
  ...lane
}: DiscoverContainerDocumentsOptions): Promise<ReadonlyArray<DocumentSummary> | null> {
  const [outcome] = await discoverContainerDocumentLanes({
    generation: await beginDocumentDiscovery(),
    lanes: [lane],
    listContainerDocumentLanes,
    loadContainerDocumentWatermark,
  });
  if (outcome?.status === "rejected") throw outcome.reason;
  return outcome?.value ?? null;
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
