/**
 * The one subscription primitive for client facade state: subscribe returns
 * an unsubscribe handle, and notify isolates subscribers so one failure
 * cannot block later subscribers.
 */
export function createListenerSet<TArgs extends ReadonlyArray<unknown> = []>() {
  const listeners = new Set<(...args: TArgs) => void>();

  return {
    subscribe: (listener: (...args: TArgs) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: (...args: TArgs): void => {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch {
          // Keep one subscriber failure from blocking later subscribers.
        }
      }
    },
  };
}
