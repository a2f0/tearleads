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

/** Serialize live remote work; abandoned coordinators cannot hold replacements. */
export function chainDocumentRemoteWork<T>(
  state: DocumentStoreState,
  task: () => Promise<T>,
): Promise<T> {
  const generation = captureDocumentStoreSyncLaneGeneration(state);
  const previous = remoteWorkByState.get(state);
  const tail =
    previous &&
    isDocumentStoreSyncLaneGenerationCurrent(state, previous.generation)
      ? previous.tail
      : Promise.resolve();
  const work = tail.then(task);
  remoteWorkByState.set(state, {
    generation,
    tail: work.then(
      () => undefined,
      () => undefined,
    ),
  });
  return work;
}
