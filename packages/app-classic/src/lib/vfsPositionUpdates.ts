import type { ClassicState, VfsLinkLikeRow } from './types';

export interface VfsLinkPositionUpdate {
  parentId: string;
  childId: string;
  position: number;
}

function linkKey(parentId: string, childId: string): string {
  return `${parentId}::${childId}`;
}

function buildLinkLookup(
  linkRows: readonly VfsLinkLikeRow[]
): Map<string, VfsLinkLikeRow> {
  const lookup = new Map<string, VfsLinkLikeRow>();
  for (const link of linkRows) {
    lookup.set(linkKey(link.parentId, link.childId), link);
  }
  return lookup;
}

function dedupePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }

  return unique;
}

/**
 * Compute minimal position updates for one parent's ordered children.
 * - ignores ids that don't have an existing link row
 * - skips updates when position is already correct
 */
export function computePositionUpdatesForParent(
  parentId: string,
  orderedChildIds: readonly string[],
  linkRows: readonly VfsLinkLikeRow[]
): VfsLinkPositionUpdate[] {
  const lookup = buildLinkLookup(linkRows);
  const uniqueChildIds = dedupePreserveOrder(orderedChildIds);
  const updates: VfsLinkPositionUpdate[] = [];
  let position = 0;

  for (const childId of uniqueChildIds) {
    const existingLink = lookup.get(linkKey(parentId, childId));
    if (!existingLink) {
      continue;
    }

    if (existingLink.position !== position) {
      updates.push({
        parentId,
        childId,
        position
      });
    }

    position += 1;
  }

  return updates;
}

/**
 * Build persisted position updates for both:
 * - tag ordering under the classic root parent
 * - note ordering under each tag
 */
export function buildClassicPositionUpdates(
  state: ClassicState,
  rootTagParentId: string,
  linkRows: readonly VfsLinkLikeRow[]
): VfsLinkPositionUpdate[] {
  const updates: VfsLinkPositionUpdate[] = [];

  const tagOrder = state.tags.map((tag) => tag.id);
  updates.push(
    ...computePositionUpdatesForParent(rootTagParentId, tagOrder, linkRows)
  );

  for (const tag of state.tags) {
    const noteOrder = state.noteOrderByTagId[tag.id] ?? [];
    updates.push(
      ...computePositionUpdatesForParent(tag.id, noteOrder, linkRows)
    );
  }

  return updates;
}
