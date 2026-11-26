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
  get size(): number;
  clear: () => void;
  /** Empty the queue, returning each container with its priority, in order. */
  drain: () => Array<readonly [string, ReconcilePriority]>;
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
    get size() {
      return priorityByContainerId.size;
    },
    clear: () => priorityByContainerId.clear(),
    drain: () => {
      const entries = Array.from(priorityByContainerId);
      priorityByContainerId.clear();
      return entries;
    },
  };
}
