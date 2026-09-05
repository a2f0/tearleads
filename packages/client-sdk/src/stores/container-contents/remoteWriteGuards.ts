import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { findSystemContainerStateForRoot } from "./systemContainerLookup";
import type { ContainerContentsStoreState } from "./types";

export type RemoteContainerWriteScope =
  | string
  | {
      rootId: string;
      systemSlot: ContainerSystemSlot;
    };
interface ActiveRemoteWrite {
  changed: boolean;
  scope: RemoteContainerWriteScope | undefined;
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
  if (changedIds?.length === 0 && movedId === undefined) return;
  for (const write of activeByState.get(state) ?? []) {
    let rootId: string | undefined;
    if (typeof write.scope === "object") {
      const root = state.containersById.get(write.scope.rootId);
      if (root) {
        rootId = findSystemContainerStateForRoot(
          state,
          write.scope.systemSlot,
          root,
        )?.container.id;
      }
    } else {
      rootId = write.scope;
    }
    if (
      write.scope === undefined ||
      changedIds === null ||
      (rootId !== undefined &&
        (changedIds.some((id) => isWithin(state, id, rootId)) ||
          (movedId !== undefined && isWithin(state, rootId, movedId))))
    ) {
      write.changed = true;
    }
  }
}

export function trackRemoteContainerWrite(
  state: ContainerContentsStoreState,
  scope?: RemoteContainerWriteScope,
) {
  const active = activeByState.get(state) ?? new Set<ActiveRemoteWrite>();
  activeByState.set(state, active);
  const write: ActiveRemoteWrite = { changed: false, scope };
  active.add(write);
  return {
    changed: () => write.changed,
    dispose: () => {
      active.delete(write);
    },
  };
}

/** An undiscovered system child has a stable slot before it has a local id. */
export function invalidateRemoteSystemContainerWrite(
  state: ContainerContentsStoreState,
  rootId: string,
  systemSlot: ContainerSystemSlot,
): void {
  for (const write of activeByState.get(state) ?? []) {
    if (
      typeof write.scope === "object" &&
      write.scope.rootId === rootId &&
      write.scope.systemSlot === systemSlot
    ) {
      write.changed = true;
    }
  }
}
