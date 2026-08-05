export interface ListenerSet<TArgs extends ReadonlyArray<unknown> = []> {
  subscribe: (listener: (...args: TArgs) => void) => () => void;
  notify: (...args: TArgs) => void;
}

/**
 * The one subscription primitive for client facade state: subscribe returns
 * an unsubscribe handle, and notify isolates subscribers so one failure
 * cannot block later subscribers.
 */
export function createListenerSet<
  TArgs extends ReadonlyArray<unknown> = [],
>(): ListenerSet<TArgs> {
  const listeners = new Set<(...args: TArgs) => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: (...args) => {
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
