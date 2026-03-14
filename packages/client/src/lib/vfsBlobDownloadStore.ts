import type { VfsBlobDownloadOperation } from '@tearleads/api-client/clientEntry';
import { useSyncExternalStore } from 'react';

let snapshot: readonly VfsBlobDownloadOperation[] = [];
const listeners = new Set<() => void>();

function areOperationsEqual(
  left: readonly VfsBlobDownloadOperation[],
  right: readonly VfsBlobDownloadOperation[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftOperation = left[index];
    const rightOperation = right[index];
    if (
      !leftOperation ||
      !rightOperation ||
      leftOperation.operationId !== rightOperation.operationId ||
      leftOperation.blobId !== rightOperation.blobId ||
      leftOperation.itemId !== rightOperation.itemId ||
      leftOperation.sizeBytes !== rightOperation.sizeBytes
    ) {
      return false;
    }
  }

  return true;
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setVfsBlobDownloadOperations(
  operations: readonly VfsBlobDownloadOperation[]
): void {
  if (areOperationsEqual(snapshot, operations)) {
    return;
  }

  snapshot = [...operations];
  emitChange();
}

export function resetVfsBlobDownloadOperations(): void {
  setVfsBlobDownloadOperations([]);
}

export function getVfsBlobDownloadOperationsSnapshot(): readonly VfsBlobDownloadOperation[] {
  return snapshot;
}

export function subscribeToVfsBlobDownloadOperations(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVfsBlobDownloadOperations(): readonly VfsBlobDownloadOperation[] {
  return useSyncExternalStore(
    subscribeToVfsBlobDownloadOperations,
    getVfsBlobDownloadOperationsSnapshot,
    getVfsBlobDownloadOperationsSnapshot
  );
}
