import type { DocumentStoreState } from "./state";
import {
  captureDocumentStoreGenerationIdentity,
  captureDocumentStoreSyncLaneGeneration,
  type DocumentStoreSyncLaneGeneration,
  isDocumentStoreGenerationIdentityCurrent,
} from "./syncGeneration";

const remoteWorkByState = new WeakMap<
  DocumentStoreState,
  {
    generation: DocumentStoreSyncLaneGeneration &
      ReturnType<typeof captureDocumentStoreGenerationIdentity>;
    tail: Promise<void>;
  }
>();

export class DocumentRemoteWorkBusyError extends Error {
  constructor(readonly whenIdle: Promise<void>) {
    super("Document remote work is still running; retry the operation");
    this.name = "DocumentRemoteWorkBusyError";
  }
}

export function getActiveDocumentRemoteWork(
  state: DocumentStoreState,
): Promise<void> | null {
  const active = remoteWorkByState.get(state);
  return active &&
    isDocumentStoreGenerationIdentityCurrent(state, active.generation)
    ? active.tail
    : null;
}

/** Never wait on another remote request inside the coordinator's serial pump. */
export function runDocumentRemoteWork<T>(
  state: DocumentStoreState,
  task: () => Promise<T>,
): Promise<T> {
  const pending = getActiveDocumentRemoteWork(state);
  if (pending) {
    return Promise.reject(new DocumentRemoteWorkBusyError(pending));
  }
  // Database/runtime replacement abandons ownership; ordinary local edits do not.
  const generation = {
    ...captureDocumentStoreGenerationIdentity(state),
    ...captureDocumentStoreSyncLaneGeneration(state),
  };
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
