import type { ContainerContentsStoreState } from "../types";

/** Publish background reads separately from the local snapshot used by writers. */
export function trackContainerHydration(state: ContainerContentsStoreState) {
  let generation = state.lifecycleGeneration;
  let pending = new Set<Promise<unknown>>();
  return (request: Promise<unknown>) => {
    if (generation !== state.lifecycleGeneration) {
      generation = state.lifecycleGeneration;
      pending = new Set();
    }
    if (pending.has(request)) return;
    pending.add(request);
    const requests = pending;
    const owner = generation;
    const finish = () => {
      requests.delete(request);
      if (state.lifecycleGeneration !== owner || requests.size > 0) return;
      const { hydrating: _finished, ...snapshot } = state.snapshot;
      state.snapshot = snapshot;
      for (const notify of state.listeners) notify();
    };
    void request.then(finish, finish);
    if (!state.snapshot.hydrating) {
      state.snapshot = { ...state.snapshot, hydrating: true };
      for (const notify of state.listeners) notify();
    }
  };
}
