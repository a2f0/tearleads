import {
  DEFAULT_CONTAINER_DOCUMENT_LANE_PAGE_LIMIT,
  MAX_CONTAINER_DOCUMENT_LANE_PAGE_TOTAL,
  MAX_CONTAINER_DOCUMENT_LANES,
} from "@tearleads/validators/request";
import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentLaneLister,
  ContainerDocumentTombstone,
  ListedContainerDocument,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

type ContainerDocumentLaneApi = Pick<
  ContainerDocumentDiscoveryApi,
  "listContainerDocumentLanes"
>;

/**
 * Rows each lane may return so a full batch stays within the single-page
 * maximum; a lone lane keeps the ordinary page size.
 */
function laneLimit(laneCount: number): number {
  return Math.max(
    1,
    Math.min(
      DEFAULT_CONTAINER_DOCUMENT_LANE_PAGE_LIMIT,
      Math.floor(MAX_CONTAINER_DOCUMENT_LANE_PAGE_TOTAL / laneCount),
    ),
  );
}

/**
 * Lists one page per requested lane in a single batched request. A lane the
 * server rejected yields `null` for that lane only; a failed request yields
 * `null` for the batch.
 */
export async function listContainerDocumentLanesFromApi(
  apiClient: ContainerDocumentLaneApi,
  lanes: Parameters<ContainerDocumentLaneLister>[0],
  reportErrors = true,
): ReturnType<ContainerDocumentLaneLister> {
  const limit = laneLimit(lanes.length);
  const requested = lanes.map((lane, index) => ({
    containerId: lane.containerId,
    laneId: `lane-${index}`,
    limit,
    watermark: lane.watermark,
  }));
  const response = await apiClient.listContainerDocumentLanes(
    { lanes: requested },
    { reportErrors },
  );
  if (!response) return null;
  const resultsByLaneId = new Map(
    response.results.map((result) => [result.laneId, result]),
  );
  return requested.map(({ laneId }) => {
    const result = resultsByLaneId.get(laneId);
    return result && "page" in result ? result.page : null;
  });
}

interface PendingContainerDocumentLane {
  readonly containerId: string;
  readonly isFullListing: boolean;
  readonly items: ListedContainerDocument[];
  readonly tombstones: ContainerDocumentTombstone[];
  watermark: SyncWatermark | null;
}

/**
 * Pages every lane to exhaustion, batching first pages and continuations
 * alike. Each container keeps its own watermark, so one lane's failure or
 * continuation never changes another lane's result.
 */
export async function listAllContainerDocumentLanes(input: {
  readonly lanes: ReadonlyArray<{
    readonly containerId: string;
    readonly watermark: SyncWatermark | null;
  }>;
  readonly listContainerDocumentLanes: ContainerDocumentLaneLister;
}): Promise<ReadonlyMap<string, ListedContainerDocuments | null>> {
  const listed = new Map<string, ListedContainerDocuments | null>();
  const pending: PendingContainerDocumentLane[] = [];
  const queued = new Set<string>();
  for (const { containerId, watermark } of input.lanes) {
    if (queued.has(containerId)) continue;
    queued.add(containerId);
    pending.push({
      containerId,
      isFullListing: watermark === null,
      items: [],
      tombstones: [],
      watermark,
    });
  }

  while (pending.length > 0) {
    const batch = pending.splice(0, MAX_CONTAINER_DOCUMENT_LANES);
    const pages = await input.listContainerDocumentLanes(
      batch.map(({ containerId, watermark }) => ({ containerId, watermark })),
    );
    batch.forEach((lane, index) => {
      const page = pages?.[index] ?? null;
      if (!page) {
        listed.set(lane.containerId, null);
        return;
      }
      lane.items.push(...page.items);
      lane.tombstones.push(...page.tombstones);
      lane.watermark = page.nextWatermark;
      if (!page.hasMore) {
        listed.set(lane.containerId, {
          isFullListing: lane.isFullListing,
          items: lane.items,
          nextWatermark: lane.watermark,
          tombstones: lane.tombstones,
        });
      } else if (lane.watermark) {
        pending.push(lane);
      } else {
        listed.set(lane.containerId, null);
      }
    });
  }
  return listed;
}

/** Lists the authoritative current ids by deliberately starting at no watermark. */
export async function listAllContainerDocumentIdsFromApi(input: {
  readonly apiClient: ContainerDocumentLaneApi;
  readonly containerId: string;
  readonly reportErrors?: boolean;
}): Promise<ReadonlyArray<string> | null> {
  const listed = (
    await listAllContainerDocumentLanes({
      lanes: [{ containerId: input.containerId, watermark: null }],
      listContainerDocumentLanes: (lanes) =>
        listContainerDocumentLanesFromApi(
          input.apiClient,
          lanes,
          input.reportErrors,
        ),
    })
  ).get(input.containerId);
  return listed
    ? Array.from(new Set(listed.items.map((document) => document.id)))
    : null;
}

/** Loads each lane's persisted watermark, then lists every lane in batches. */
export async function listContainerDocumentsFromWatermarks(input: {
  readonly containerIds: ReadonlyArray<string>;
  readonly listContainerDocumentLanes: ContainerDocumentLaneLister;
  readonly loadContainerDocumentWatermark: (
    containerId: string,
  ) => Promise<SyncWatermark | null>;
}): Promise<ReadonlyMap<string, ListedContainerDocuments | null>> {
  const lanes: Array<{ containerId: string; watermark: SyncWatermark | null }> =
    [];
  for (const containerId of new Set(input.containerIds)) {
    lanes.push({
      containerId,
      watermark: await input.loadContainerDocumentWatermark(containerId),
    });
  }
  return listAllContainerDocumentLanes({
    lanes,
    listContainerDocumentLanes: input.listContainerDocumentLanes,
  });
}
