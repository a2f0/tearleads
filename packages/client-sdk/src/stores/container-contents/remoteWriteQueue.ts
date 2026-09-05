import { errorMessage } from "../../data/errorMessage";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";
import { captureContainerWriteGeneration } from "./writeGeneration";

const remoteWritesByState = new WeakMap<
  ContainerContentsStoreState,
  Promise<void>
>();

/** Online operations serialize together; local writes never wait for their I/O. */
export function chainRemoteContainerTask<T>(
  state: ContainerContentsStoreState,
  syncAgent: ContainerContentsStoreSyncAgent,
  staleResult: T,
  work: (isCurrent: () => boolean) => Promise<T>,
): Promise<T> {
  const contextCurrent = captureContainerWriteGeneration(state);
  const previous = remoteWritesByState.get(state) ?? Promise.resolve();
  const task = previous.then(async () => {
    let localWrites: typeof state.writeChain;
    do {
      localWrites = state.writeChain;
      await localWrites.catch(() => null);
    } while (contextCurrent() && localWrites !== state.writeChain);
    const isCurrent = () =>
      contextCurrent() && state.writeChain === localWrites;
    if (!isCurrent()) return staleResult;
    try {
      const result = await work(isCurrent);
      return isCurrent() ? result : staleResult;
    } finally {
      if (contextCurrent() && state.writeChain !== localWrites) {
        // The HTTP side may have committed before a new local write invalidated
        // this operation. Reconcile its authoritative result without allowing
        // the older operation to install state over the user's newer write.
        state.localContainersNeedRefresh = true;
        void syncAgent.refreshLocalContainers().catch((error: unknown) => {
          state.runtime.util.log(
            `Container contents: local refresh failed (${errorMessage(error)})`,
          );
        });
        syncAgent.scheduleRemoteHydration();
      }
    }
  });
  remoteWritesByState.set(
    state,
    task.then(
      () => undefined,
      () => undefined,
    ),
  );
  return task;
}
