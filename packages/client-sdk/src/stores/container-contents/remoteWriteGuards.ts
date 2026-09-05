import type { ContainerContentsStoreState } from "./types";

interface ActiveRemoteWrite {
  changed: boolean;
  rootId: string | undefined;
}
const activeByState = new WeakMap<
  ContainerContentsStoreState,
  Set<ActiveRemoteWrite>
>();

function isWithin(
  state: ContainerContentsStoreState,
  id: string,
  rootId: string,
): boolean {
  const visited = new Set<string>();
  let current: string | null = id;
  while (current !== null && !visited.has(current)) {
    if (current === rootId) return true;
    visited.add(current);
    current = state.containersById.get(current)?.container.parentId ?? null;
  }
  return false;
}

/** Invalidate remote settlement only when a local edit touches its subtree. */
export function invalidateRemoteContainerWrites(
  state: ContainerContentsStoreState,
  changedIds: readonly string[] | null,
  movedId?: string,
): void {
  for (const write of activeByState.get(state) ?? []) {
    const rootId = write.rootId;
    if (
      rootId === undefined ||
      changedIds === null ||
      changedIds.some((id) => isWithin(state, id, rootId)) ||
      (movedId !== undefined && isWithin(state, rootId, movedId))
    ) {
      write.changed = true;
    }
  }
}

export function trackRemoteContainerWrite(
  state: ContainerContentsStoreState,
  rootId?: string,
) {
  const active = activeByState.get(state) ?? new Set<ActiveRemoteWrite>();
  activeByState.set(state, active);
  const write: ActiveRemoteWrite = { changed: false, rootId };
  active.add(write);
  return {
    changed: () => write.changed,
    dispose: () => {
      active.delete(write);
    },
  };
}
