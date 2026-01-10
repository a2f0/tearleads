/**
 * Hook for subscribing to instance change events.
 * Components can use this to clean up instance-specific state when switching instances.
 */

import { useEffect } from 'react';

type InstanceChangeCallback = (
  newInstanceId: string | null,
  previousInstanceId: string | null
) => void;

const listeners = new Set<InstanceChangeCallback>();
let lastInstanceId: string | null = null;

/**
 * Emit an instance change event to all subscribers.
 * Called by DatabaseProvider when switchInstance or createInstance completes.
 */
export function emitInstanceChange(newInstanceId: string | null): void {
  const previous = lastInstanceId;
  lastInstanceId = newInstanceId;

  // Only emit if the instance actually changed
  if (previous !== newInstanceId) {
    for (const listener of listeners) {
      try {
        listener(newInstanceId, previous);
      } catch (error) {
        console.error('Error in instance change listener:', error);
      }
    }
  }
}

/**
 * Subscribe to instance change events.
 * Returns an unsubscribe function.
 */
export function subscribeToInstanceChange(
  callback: InstanceChangeCallback
): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Hook that calls the provided callback when the instance changes.
 * The callback receives (newInstanceId, previousInstanceId).
 */
export function useOnInstanceChange(callback: InstanceChangeCallback): void {
  useEffect(() => {
    return subscribeToInstanceChange(callback);
  }, [callback]);
}

/**
 * Get the current listener count (useful for testing).
 */
export function getListenerCount(): number {
  return listeners.size;
}

/**
 * Reset state for testing purposes.
 */
export function resetInstanceChangeState(): void {
  listeners.clear();
  lastInstanceId = null;
}
