import { useSyncExternalStore } from "react";

export function useSymCryptStoreSnapshot<TSnapshot>(store: {
  readonly snapshot: TSnapshot;
  subscribe(listener: () => void): () => void;
}): TSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );
}

export function useSymCryptExternalValue<TValue>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => TValue,
): TValue {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSymCryptExternalStoreSnapshot<TSnapshot>(store: {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}): TSnapshot {
  return useSymCryptExternalValue(store.subscribe, store.getSnapshot);
}
