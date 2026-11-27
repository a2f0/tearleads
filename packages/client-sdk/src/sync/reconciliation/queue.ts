/**
 * Priority work queue for the background reconciler (Layer B).
 *
 * The active container reconciles first; everything else drains at idle
 * priority. De-duplicates container ids so repeated triggers (effects,
 * WebSocket events, prerequisite changes) collapse into a single pending unit
 * of work per container.
 */
export type ReconcilePriority = "active" | "idle";

export interface ReconcileQueue {
  /** Queue a container, upgrading an existing idle entry to active if needed. */
  enqueue: (containerId: string, priority: ReconcilePriority) => void;
  /**
   * Take the next container to reconcile (active before idle), or null.
   * With `accepts`, take the next one it accepts and leave the others queued.
   */
  dequeue: (accepts?: (containerId: string) => boolean) => string | null;
  /** Whether the container is queued. */
  has: (containerId: string) => boolean;
  get size(): number;
  clear: () => void;
  /**
   * Take every queued container, or with `accepts` each one it accepts,
   * returning each with its priority, in order.
   */
  drain: (
    accepts?: (containerId: string) => boolean,
  ) => Array<readonly [string, ReconcilePriority]>;
}

export function createReconcileQueue(): ReconcileQueue {
  // Insertion order is preserved within each priority by Map semantics; an
  // in-place priority upgrade keeps the original insertion position.
  const priorityByContainerId = new Map<string, ReconcilePriority>();

  const takeByPriority = (
    priority: ReconcilePriority,
    accepts: (containerId: string) => boolean,
  ): string | null => {
    for (const [containerId, entryPriority] of priorityByContainerId) {
      if (entryPriority === priority && accepts(containerId)) {
        priorityByContainerId.delete(containerId);
        return containerId;
      }
    }
    return null;
  };

  return {
    enqueue: (containerId, priority) => {
      const existing = priorityByContainerId.get(containerId);
      if (existing) {
        if (priority === "active" && existing === "idle") {
          priorityByContainerId.set(containerId, "active");
        }
        return;
      }
      priorityByContainerId.set(containerId, priority);
    },
    dequeue: (accepts = () => true) =>
      takeByPriority("active", accepts) ?? takeByPriority("idle", accepts),
    has: (containerId) => priorityByContainerId.has(containerId),
    get size() {
      return priorityByContainerId.size;
    },
    clear: () => priorityByContainerId.clear(),
    drain: (accepts = () => true) => {
      const entries = Array.from(priorityByContainerId).filter(
        ([containerId]) => accepts(containerId),
      );
      for (const [containerId] of entries) {
        priorityByContainerId.delete(containerId);
      }
      return entries;
    },
  };
}
