import { useSyncExternalStore } from "react";

type StoreChangeListener = () => void;

interface SnapshotStore<TSnapshot> {
  readonly snapshot: TSnapshot;
  subscribe(listener: StoreChangeListener): () => void;
}

interface ExternalSnapshotStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: StoreChangeListener): () => void;
}

export function useTearleadsStoreSnapshot<TSnapshot>(
  store: SnapshotStore<TSnapshot>,
): TSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );
}

export function useTearleadsExternalValue<TValue>(
  subscribe: (listener: StoreChangeListener) => () => void,
  getSnapshot: () => TValue,
): TValue {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useTearleadsExternalStoreSnapshot<TSnapshot>(
  store: ExternalSnapshotStore<TSnapshot>,
): TSnapshot {
  return useTearleadsExternalValue(store.subscribe, store.getSnapshot);
}
