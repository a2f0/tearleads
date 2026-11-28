import type { ContainerParentHydrationLane } from "../types";

interface PaginatedParentLanePage {
  readonly lane: ContainerParentHydrationLane;
  readonly response: {
    readonly hasMore: boolean;
    readonly nextWatermark: ContainerParentHydrationLane["watermark"] | null;
  };
}

function cursorKey(
  watermark: NonNullable<ContainerParentHydrationLane["watermark"]>,
): string {
  return JSON.stringify([watermark.updatedAt, watermark.id]);
}

export function hasUnusableContinuation({
  lane,
  response,
}: PaginatedParentLanePage): boolean {
  const next = response.nextWatermark;
  if (!next) return response.hasMore;
  // Opaque positions can advance with an older business timestamp.
  // A drained lane may echo its current position, but never an earlier one.
  if (
    next.id === lane.watermark?.id &&
    next.updatedAt === lane.watermark.updatedAt
  )
    return response.hasMore;
  return lane.continuationCursors?.has(cursorKey(next)) === true;
}

export function queueNextPage(
  { lane, response }: PaginatedParentLanePage,
  skipWatermarkWrite: boolean,
  queueContinuationLane: (lane: ContainerParentHydrationLane) => void,
): void {
  if (response.hasMore && response.nextWatermark) {
    const continuationCursors = lane.continuationCursors ?? new Set<string>();
    if (lane.watermark) continuationCursors.add(cursorKey(lane.watermark));
    continuationCursors.add(cursorKey(response.nextWatermark));
    queueContinuationLane({
      ...(lane.idsOnly ? { idsOnly: true as const } : {}),
      ...(lane.membershipOnly ? { membershipOnly: true as const } : {}),
      parentId: lane.parentId,
      watermark: response.nextWatermark,
      skipWatermarkWrite,
      continuationCursors,
    });
  }
}
