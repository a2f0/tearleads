import {
  type ContainerSyncWatermarkLane,
  ContainerSyncWatermarkRepository,
} from "../../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type {
  ContainerChildIndex,
  ListedRemoteContainerPageItem,
} from "../types";

type RestoredContainer = ListedRemoteContainerPageItem & {
  restorationId: string;
};

const lane = (containerId: string): ContainerSyncWatermarkLane => ({
  kind: "container_restoration",
  containerId,
});

/** The same access loss can appear on later folder publications. Read all
 * receipts for this page together; ordinary pages need no SQLite lookup. */
export async function pendingFolderRestorations(input: {
  childIdsByParentId: ContainerChildIndex;
  execSql: ExecSql;
  isPaused?: ((item: ListedRemoteContainerPageItem) => boolean) | undefined;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
}): Promise<RestoredContainer[]> {
  const candidates = input.items.filter(
    (item): item is RestoredContainer =>
      !!item.restorationId &&
      !input.isPaused?.(item) &&
      !!input.childIdsByParentId.get(item.id)?.size,
  );
  if (!candidates.length) return [];
  const receipts = await new ContainerSyncWatermarkRepository(
    input.execSql,
  ).loadWatermarkRecords(candidates.map((item) => lane(item.id)));
  return candidates.filter(
    (item, index) => receipts[index]?.watermark.id !== item.restorationId,
  );
}

export async function recordFolderRestoration(
  execSql: ExecSql,
  item: RestoredContainer | undefined,
  settled: boolean,
  stillCurrent: () => boolean,
) {
  if (!item || !settled) return settled;
  return new ContainerSyncWatermarkRepository(execSql).saveWatermark(
    lane(item.id),
    {
      id: item.restorationId,
      updatedAt: item.updatedAt,
    },
    { stillCurrent },
  );
}
