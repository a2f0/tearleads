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
  /** Take the next container to reconcile (active before idle), or null. */
  dequeue: () => string | null;
  get size(): number;
  clear: () => void;
}

export function createReconcileQueue(): ReconcileQueue {
  // Insertion order is preserved within each priority by Map semantics; an
  // in-place priority upgrade keeps the original insertion position.
  const priorityByContainerId = new Map<string, ReconcilePriority>();

  const takeByPriority = (priority: ReconcilePriority): string | null => {
    for (const [containerId, entryPriority] of priorityByContainerId) {
      if (entryPriority === priority) {
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
    dequeue: () => takeByPriority("active") ?? takeByPriority("idle"),
    get size() {
      return priorityByContainerId.size;
    },
    clear: () => priorityByContainerId.clear(),
  };
}
