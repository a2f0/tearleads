import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import type {
  ContainerSyncTombstone,
  ListContainersResponse,
} from "@tearleads/validators/response";
import { isCanonicalSignedAt } from "@tearleads/validators/util";
import { removeIndexedContainerChild } from "./lanes/childIndex";
import { resolveTombstoneCascade } from "./lanes/tombstoneAccess";
import { containerStateMatchesFingerprint } from "./remoteContainers/containerStateFingerprint";
import type {
  ContainerChildIndex,
  ExpectedContainerState,
  ListedRemoteContainerPageItem,
  RemoteContainerHydrationState,
} from "./types";

function latestContainerItemsById(
  items: ReadonlyArray<ListedRemoteContainerPageItem>,
): Map<string, ListedRemoteContainerPageItem> {
  const latestItems = new Map<string, ListedRemoteContainerPageItem>();
  for (const item of items) {
    const current = latestItems.get(item.id);
    if (!current || current.updatedAt < item.updatedAt) {
      latestItems.set(item.id, item);
    }
  }

  return latestItems;
}

function latestContainerTombstonesById(
  tombstones: ReadonlyArray<ContainerSyncTombstone>,
): Map<string, ContainerSyncTombstone> {
  const latestTombstones = new Map<string, ContainerSyncTombstone>();
  for (const tombstone of tombstones) {
    if (!isCanonicalSignedAt(tombstone.updatedAt))
      throw new Error("Container tombstone timestamp is not canonical");
    const current = latestTombstones.get(tombstone.containerId);
    if (
      !current ||
      current.updatedAt < tombstone.updatedAt ||
      (current.updatedAt === tombstone.updatedAt &&
        current.reason === "access_revoked" &&
        tombstone.reason === "deleted")
    ) {
      latestTombstones.set(tombstone.containerId, tombstone);
    }
  }

  return latestTombstones;
}

function getApplicableContainerTombstones(
  response: ListContainersResponse,
): ContainerSyncTombstone[] {
  const latestItems = latestContainerItemsById(response.items);
  return Array.from(
    latestContainerTombstonesById(response.tombstones).values(),
  ).filter((tombstone) => {
    const item = latestItems.get(tombstone.containerId);
    return (
      !item ||
      item.updatedAt < tombstone.updatedAt ||
      (item.updatedAt === tombstone.updatedAt && tombstone.reason === "deleted")
    );
  });
}

export function getApplicableRemoteContainerItems(
  response: ListContainersResponse,
): ListedRemoteContainerPageItem[] {
  const latestTombstones = latestContainerTombstonesById(response.tombstones);
  return response.items.filter((item) => {
    const tombstone = latestTombstones.get(item.id);
    return (
      !tombstone ||
      tombstone.updatedAt < item.updatedAt ||
      (tombstone.updatedAt === item.updatedAt &&
        tombstone.reason === "access_revoked")
    );
  });
}

async function applyContainerTombstoneCascade(input: {
  reconcileDescendants: boolean;
  afterParentPage: ListContainerDocumentLanesRequest["afterParentPage"];
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  isCurrent?: (() => boolean) | undefined;
  preservedContainerIds: ReadonlySet<string>;
  state: RemoteContainerHydrationState;
  tombstone: ContainerSyncTombstone;
}): Promise<{ current: boolean; removedCount: number; settled: boolean }> {
  const { childIdsByParentId, expectedContainerStates, state } = input;
  const resolved = await resolveTombstoneCascade(input);
  if (!resolved || input.isCurrent?.() === false)
    return {
      current: input.isCurrent?.() !== false,
      removedCount: 0,
      settled: false,
    };
  const {
    fenceOnlyContainerIds,
    absentDeletedContainerIds,
    removalByContainerId,
    removedContainerIds,
  } = resolved.cascade;
  const affectedContainerIds = new Set([
    ...removedContainerIds,
    ...absentDeletedContainerIds,
    ...fenceOnlyContainerIds,
  ]);
  for (const containerId of affectedContainerIds) {
    if (
      !containerStateMatchesFingerprint({
        currentState: state.containersById.get(containerId),
        expectedFingerprint:
          expectedContainerStates.get(containerId)?.fingerprint,
      })
    ) {
      return { current: true, removedCount: 0, settled: false };
    }
  }

  const deletedContainerIds = await state.persistence.deleteContainers(
    state.runtime.infra.execSql,
    [
      ...removedContainerIds,
      ...absentDeletedContainerIds,
      ...fenceOnlyContainerIds,
    ].flatMap((containerId) => {
      const removal = removalByContainerId.get(containerId);
      return removal ? [{ containerId, ...removal }] : [];
    }),
    {
      discoveryOnly: true,
      expectedContainers: Array.from(affectedContainerIds, (containerId) => ({
        containerId,
        ...(resolved.denied?.has(containerId)
          ? { confirmedAccessLoss: true as const }
          : {}),
        expectedContainer:
          expectedContainerStates.get(containerId)?.container ?? null,
      })),
      stillCurrent: input.isCurrent,
    },
  );
  if (deletedContainerIds.length !== affectedContainerIds.size) {
    return { current: true, removedCount: 0, settled: false };
  }
  if (input.isCurrent?.() === false) {
    return { current: false, removedCount: 0, settled: false };
  }
  for (const containerId of removedContainerIds) {
    const parentId =
      state.containersById.get(containerId)?.container.parentId ?? null;
    removeIndexedContainerChild(childIdsByParentId, containerId, parentId);
    childIdsByParentId.delete(containerId);
    state.containersById.delete(containerId);
  }

  return {
    current: true,
    removedCount: removedContainerIds.length,
    settled: true,
  };
}

function preserveOtherRoots(
  state: RemoteContainerHydrationState,
  liveContainerIds: ReadonlyArray<string>,
  tombstoneRootIds: ReadonlySet<string>,
  rootId: string,
) {
  const preservedContainerIds = new Set([
    ...liveContainerIds,
    ...tombstoneRootIds,
    ...Array.from(state.containersById, ([id, state]) =>
      state.container.metadataDocumentId === null ? id : null,
    ).filter((id): id is string => id !== null),
  ]);
  if (state.containersById.get(rootId)?.container.metadataDocumentId !== null) {
    preservedContainerIds.delete(rootId);
  }
  return preservedContainerIds;
}

export async function applyContainerTombstones(input: {
  parentId: string | null;
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  isCurrent?: (() => boolean) | undefined;
  isPaused?: (item: ListedRemoteContainerPageItem) => boolean;
  remoteContainerItems: ReadonlyArray<ListedRemoteContainerPageItem>;
  response: ListContainersResponse;
  state: RemoteContainerHydrationState;
}): Promise<{ changedCount: number; completed: boolean; current: boolean }> {
  // A folder can regain access after one of its cached children moved away.
  // Its live listing keeps the folder and reconciles the previously held tree.
  const restored = input.remoteContainerItems.filter(
    (item) =>
      item.reconcileDescendants &&
      !input.isPaused?.(item) &&
      input.childIdsByParentId.get(item.id)?.size,
  );
  const restoredById = new Map(restored.map((item) => [item.id, item]));
  const tombstones = [
    ...getApplicableContainerTombstones(input.response),
    ...restored.map((item) => ({
      containerId: item.id,
      parentId: item.parentId,
      depth: item.depth,
      updatedAt: item.updatedAt,
      reason: "access_revoked" as const,
    })),
  ];
  if (tombstones.length === 0 || input.isCurrent?.() === false) {
    return {
      changedCount: 0,
      completed: true,
      current: input.isCurrent?.() !== false,
    };
  }

  const tombstoneRootIds = new Set(
    tombstones.map((tombstone) => tombstone.containerId),
  );
  const liveContainerIds = input.remoteContainerItems.map((item) => item.id);
  let changedCount = 0;
  let completed = true;
  for (const tombstone of tombstones) {
    if (input.isCurrent?.() === false) {
      return { changedCount, completed: false, current: false };
    }
    // Apply each root as its own CAS-protected cascade. Other explicit roots
    // stay out of this cascade so their own reason wins and one stale root
    // cannot block independent tombstones or live items on the page.
    const preservedContainerIds = preserveOtherRoots(
      input.state,
      liveContainerIds,
      tombstoneRootIds,
      tombstone.containerId,
    );
    const live = restoredById.get(tombstone.containerId);
    const result = await applyContainerTombstoneCascade({
      reconcileDescendants: live !== undefined,
      afterParentPage: input.response.nextWatermark
        ? { parentId: input.parentId, watermark: input.response.nextWatermark }
        : undefined,
      childIdsByParentId: input.childIdsByParentId,
      expectedContainerStates: input.expectedContainerStates,
      isCurrent: live
        ? () => input.isCurrent?.() !== false && !input.isPaused?.(live)
        : input.isCurrent,
      preservedContainerIds,
      state: input.state,
      tombstone,
    });
    changedCount += result.removedCount;
    if (live && input.isPaused?.(live) && input.isCurrent?.() !== false)
      continue;
    completed = completed && result.settled;
    if (!result.current) {
      return { changedCount, completed: false, current: false };
    }
  }

  return { changedCount, completed, current: true };
}
