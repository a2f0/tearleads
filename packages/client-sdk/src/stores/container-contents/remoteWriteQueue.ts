import { errorMessage } from "../../data/errorMessage";
import {
  type RemoteContainerWriteScope,
  trackRemoteContainerWrite,
} from "./remoteWriteGuards";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";
import { captureContainerWriteGeneration } from "./writeGeneration";

const remoteWritesByState = new WeakMap<
  ContainerContentsStoreState,
  { current: () => boolean; tail: Promise<void> }
>();

/** Online operations serialize together; local writes never wait for their I/O. */
export function chainRemoteContainerTask<T>(
  state: ContainerContentsStoreState,
  syncAgent: Pick<
    ContainerContentsStoreSyncAgent,
    "refreshLocalContainers" | "scheduleRemoteHydration"
  >,
  staleResult: T,
  work: (isCurrent: () => boolean) => Promise<T>,
  scope?: RemoteContainerWriteScope,
): Promise<T> {
  const contextCurrent = captureContainerWriteGeneration(state);
  const previous = remoteWritesByState.get(state);
  const tail = previous?.current() ? previous.tail : Promise.resolve();
  const task = tail.then(async () => {
    if (!contextCurrent()) return staleResult;
    // Install the guard at one local queue boundary. New writes can proceed
    // immediately afterward; an ongoing stream cannot starve the remote task.
    const boundary = state.writeChain
      .catch(() => null)
      .then(() => trackRemoteContainerWrite(state, scope));
    state.writeChain = boundary.then(() => null);
    const tracked = await boundary;
    const isCurrent = () => contextCurrent() && !tracked.changed();
    try {
      if (!isCurrent()) return staleResult;
      const result = await work(isCurrent);
      return isCurrent() ? result : staleResult;
    } finally {
      tracked.dispose();
      if (contextCurrent() && tracked.changed()) {
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
  remoteWritesByState.set(state, {
    current: contextCurrent,
    tail: task.then(
      () => undefined,
      () => undefined,
    ),
  });
  return task;
}
