import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  findOrganizationSystemRootState,
  findSystemContainerStateForRoot,
} from "../systemContainers/systemContainerLookup";
import type { ContainerContentsStoreState } from "../types";
import { isContainerInSubtree } from "../utils";

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

/** The container a write's scope settles: a system slot resolves to its root. */
function resolveWriteRootId(
  state: ContainerContentsStoreState,
  scope: RemoteContainerWriteScope | undefined,
): string | undefined {
  if (typeof scope !== "object") return scope;
  const root = state.containersById.get(scope.rootId);
  if (!root) return undefined;
  return (
    findSystemContainerStateForRoot(state, scope.systemSlot, root) ??
    findOrganizationSystemRootState(
      state,
      root.container.organizationId || state.runtime.auth.organizationId || "",
      scope.systemSlot,
    )
  )?.container.id;
}

/** Invalidate remote settlement only when a local edit touches its subtree. */
export function invalidateRemoteContainerWrites(
  state: ContainerContentsStoreState,
  changedIds: readonly string[] | null,
  movedId?: string,
): void {
  if (changedIds?.length === 0 && movedId === undefined) return;
  for (const write of activeByState.get(state) ?? []) {
    const rootId = resolveWriteRootId(state, write.scope);
    if (
      write.scope === undefined ||
      changedIds === null ||
      (rootId !== undefined &&
        (changedIds.some((id) =>
          isContainerInSubtree(state.containersById, id, rootId),
        ) ||
          (movedId !== undefined &&
            isContainerInSubtree(state.containersById, rootId, movedId))))
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
