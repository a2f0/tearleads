import { useSyncExternalStore } from "react";

export function useTearleadsStoreSnapshot<TSnapshot>(store: {
  readonly snapshot: TSnapshot;
  subscribe(listener: () => void): () => void;
}): TSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );
}

export function useTearleadsExternalValue<TValue>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => TValue,
): TValue {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useTearleadsExternalStoreSnapshot<TSnapshot>(store: {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}): TSnapshot {
  return useTearleadsExternalValue(store.subscribe, store.getSnapshot);
}
