import type { DocumentStoreState } from "./state";

const remoteWorkByState = new WeakMap<DocumentStoreState, Promise<void>>();

/** Serialize remote sync and rotation settlement without blocking local edits. */
export function chainDocumentRemoteWork<T>(
  state: DocumentStoreState,
  task: () => Promise<T>,
): Promise<T> {
  const previous = remoteWorkByState.get(state) ?? Promise.resolve();
  const work = previous.then(task);
  remoteWorkByState.set(
    state,
    work.then(
      () => undefined,
      () => undefined,
    ),
  );
  return work;
}
