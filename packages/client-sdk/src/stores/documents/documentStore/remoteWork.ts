import type { DocumentStoreState } from "./state";
import {
  captureDocumentStoreSyncLaneGeneration,
  type DocumentStoreSyncLaneGeneration,
  isDocumentStoreSyncLaneGenerationCurrent,
} from "./syncGeneration";

const remoteWorkByState = new WeakMap<
  DocumentStoreState,
  {
    generation: DocumentStoreSyncLaneGeneration;
    tail: Promise<void>;
  }
>();

export function getActiveDocumentRemoteWork(
  state: DocumentStoreState,
): Promise<void> | null {
  const active = remoteWorkByState.get(state);
  return active &&
    isDocumentStoreSyncLaneGenerationCurrent(state, active.generation)
    ? active.tail
    : null;
}

/** Never wait on another remote request inside the coordinator's serial pump. */
export function runDocumentRemoteWork<T>(
  state: DocumentStoreState,
  task: () => Promise<T>,
): Promise<T> {
  if (getActiveDocumentRemoteWork(state)) {
    return Promise.reject(
      new Error("Document remote work is still running; retry the operation"),
    );
  }
  const generation = captureDocumentStoreSyncLaneGeneration(state);
  const work = Promise.resolve()
    .then(task)
    .finally(() => {
      if (remoteWorkByState.get(state) === active) {
        remoteWorkByState.delete(state);
      }
    });
  const active = {
    generation,
    tail: work.then(
      () => undefined,
      () => undefined,
    ),
  };
  remoteWorkByState.set(state, active);
  return work;
}
