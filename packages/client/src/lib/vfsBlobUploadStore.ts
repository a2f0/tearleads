import { useSyncExternalStore } from 'react';

interface VfsBlobUploadActivityEntry {
  operationId: string;
  kind: string;
  success: boolean;
  timestamp: string;
  retryCount: number;
  failureClass?: string | undefined;
}

const MAX_ENTRIES = 50;

let snapshot: readonly VfsBlobUploadActivityEntry[] = [];
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function pushVfsBlobUploadActivity(
  entry: VfsBlobUploadActivityEntry
): void {
  snapshot = [...snapshot, entry].slice(-MAX_ENTRIES);
  emitChange();
}

export function resetVfsBlobUploadActivity(): void {
  if (snapshot.length === 0) {
    return;
  }
  snapshot = [];
  emitChange();
}

function getSnapshot(): readonly VfsBlobUploadActivityEntry[] {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVfsBlobUploadActivity(): readonly VfsBlobUploadActivityEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
