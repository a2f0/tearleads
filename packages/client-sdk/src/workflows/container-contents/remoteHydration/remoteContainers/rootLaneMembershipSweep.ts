import type {
  ContainerParentHydrationLane,
  HydrationOutcome,
  RemoteContainerHydrationState,
} from "../types";

/**
 * Tracks one authoritative unwatermarked root-lane sweep across all of its
 * continuation pages. Tagged lanes (`rootMembershipSweepId`) own the sweep so
 * sibling root lanes (for example a watermarked delta lane paired with an
 * `idsOnly` membership sweep) never overwrite each other's observations.
 */
export interface RootLaneMembershipSweep {
  activeSweepId: number | null;
  complete: boolean;
  failed: boolean;
  nextSweepId: number;
  readonly observedIds: Set<string>;
}

export function createRootLaneMembershipSweep(
  lanes: ReadonlyArray<ContainerParentHydrationLane>,
): RootLaneMembershipSweep {
  let maxSweepId = 0;
  let activeSweepId: number | null = null;
  for (const lane of lanes) {
    if (lane.parentId === null && lane.rootMembershipSweepId !== undefined) {
      activeSweepId = lane.rootMembershipSweepId;
      if (lane.rootMembershipSweepId > maxSweepId) {
        maxSweepId = lane.rootMembershipSweepId;
      }
    }
  }
  return {
    activeSweepId,
    complete: false,
    failed: false,
    nextSweepId: maxSweepId + 1,
    observedIds: new Set(),
  };
}

/**
 * Resolve the sweep id for a root-lane page. If no sweep was pre-tagged
 * (cold-start unwatermarked root lane), page 1 claims a fresh sweep id so
 * continuation pages inherit it through `queueNextPage`.
 */
function resolveRootMembershipSweepId(
  sweep: RootLaneMembershipSweep,
  lane: ContainerParentHydrationLane,
): number | null {
  if (lane.parentId !== null) return null;
  if (lane.rootMembershipSweepId !== undefined) {
    return lane.rootMembershipSweepId === sweep.activeSweepId
      ? lane.rootMembershipSweepId
      : null;
  }
  if (
    sweep.activeSweepId === null &&
    lane.watermark === null &&
    !lane.continuationCursors
  ) {
    const claimed = sweep.nextSweepId++;
    sweep.activeSweepId = claimed;
    return claimed;
  }
  return null;
}

/**
 * Transfer active sweep ownership to a new full-listing fallback sweep,
 * discarding any partial observations from the superseded `idsOnly` sweep.
 */
export function startFallbackRootMembershipSweep(
  sweep: RootLaneMembershipSweep,
): number {
  const nextId = sweep.nextSweepId++;
  sweep.activeSweepId = nextId;
  sweep.complete = false;
  sweep.failed = false;
  sweep.observedIds.clear();
  return nextId;
}

export function markRootMembershipSweepFailed(
  sweep: RootLaneMembershipSweep,
  lane: ContainerParentHydrationLane,
): void {
  if (
    lane.parentId === null &&
    lane.rootMembershipSweepId !== undefined &&
    lane.rootMembershipSweepId === sweep.activeSweepId
  ) {
    sweep.failed = true;
    sweep.complete = false;
  }
}

export function recordRootMembershipPage(input: {
  readonly hasMore: boolean;
  readonly itemIds: ReadonlyArray<string>;
  readonly lane: ContainerParentHydrationLane;
  readonly outcome: HydrationOutcome;
  readonly sweep: RootLaneMembershipSweep;
}): number | null {
  const sweepId = resolveRootMembershipSweepId(input.sweep, input.lane);
  if (sweepId === null) return null;
  if (input.outcome !== "complete") {
    input.sweep.failed = true;
    input.sweep.complete = false;
    return sweepId;
  }
  for (const id of input.itemIds) {
    input.sweep.observedIds.add(id);
  }
  if (!input.hasMore && !input.sweep.failed) {
    input.sweep.complete = true;
  }
  return sweepId;
}

function collectRootLaneMemberChanges(
  containersById: RemoteContainerHydrationState["containersById"],
  observedIds: ReadonlySet<string>,
): { readonly addIds: string[]; readonly removeIds: string[] } {
  const addIds: string[] = [];
  const removeIds: string[] = [];
  for (const [id, entry] of containersById) {
    if (
      entry.container.parentId === null ||
      entry.container.serverCreatedAt == null
    ) {
      continue;
    }
    const isRootMember = observedIds.has(id);
    if (isRootMember && entry.container.rootLaneMember !== true) {
      addIds.push(id);
    } else if (!isRootMember && entry.container.rootLaneMember === true) {
      removeIds.push(id);
    }
  }
  return { addIds, removeIds };
}

function applyRootLaneMemberChangeInMemory(
  containersById: RemoteContainerHydrationState["containersById"],
  ids: ReadonlyArray<string>,
  nextValue: true | undefined,
): number {
  let updated = 0;
  for (const id of ids) {
    const current = containersById.get(id);
    if (!current || current.container.rootLaneMember === nextValue) continue;
    current.container = { ...current.container, rootLaneMember: nextValue };
    updated++;
  }
  return updated;
}

export async function reconcileRootLaneMembers(input: {
  readonly isCurrent?: (() => boolean) | undefined;
  readonly rootMembership: RootLaneMembershipSweep;
  readonly state: RemoteContainerHydrationState;
}): Promise<number> {
  if (
    !input.rootMembership.complete ||
    input.rootMembership.failed ||
    input.isCurrent?.() === false
  ) {
    return 0;
  }
  const { addIds, removeIds } = collectRootLaneMemberChanges(
    input.state.containersById,
    input.rootMembership.observedIds,
  );
  if (addIds.length === 0 && removeIds.length === 0) return 0;
  const committed = await input.state.persistence.setRootLaneMembers?.(
    input.state.runtime.infra.execSql,
    { addIds, removeIds, stillCurrent: input.isCurrent },
  );
  if (committed === false || input.isCurrent?.() === false) return 0;
  return (
    applyRootLaneMemberChangeInMemory(
      input.state.containersById,
      addIds,
      true,
    ) +
    applyRootLaneMemberChangeInMemory(
      input.state.containersById,
      removeIds,
      undefined,
    )
  );
}
