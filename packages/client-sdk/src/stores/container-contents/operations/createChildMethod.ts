import { chainContainerWrite } from "../remoteWrites/localWriteQueue";
import type { ContainerContentsStoreSyncAgent } from "../syncAgent";
import type {
  ContainerContentsStore,
  ContainerContentsStoreState,
} from "../types";
import { createChildContainer } from ".";

/** The store's `createChild`, queued behind other local writes to the parent. */
export function createChildMethod(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
): ContainerContentsStore["createChild"] {
  return (parentId, name, options) =>
    chainContainerWrite(
      state,
      (isCurrent) =>
        createChildContainer(
          state,
          syncAgent,
          parentId,
          name,
          isCurrent,
          options,
        ),
      [parentId],
    );
}
