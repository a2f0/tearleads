/**
 * Priority work queue for the background reconciler (Layer B).
 *
 * The active container reconciles first; everything else drains at idle
 * priority. De-duplicates container ids so repeated triggers (effects,
 * WebSocket events, prerequisite changes) collapse into a single pending unit
 * of work per container.
 */
export type ReconcilePriority = "active" | "idle";

interface ReconcileQueueEntry {
  containerId: string;
  priority: ReconcilePriority;
}

export interface ReconcileQueue {
  /** Queue a container, upgrading an existing idle entry to active if needed. */
  enqueue: (containerId: string, priority: ReconcilePriority) => void;
  /** Take the next container to reconcile (active before idle), or null. */
  dequeue: () => string | null;
  get size(): number;
  clear: () => void;
}

export function createReconcileQueue(): ReconcileQueue {
  // Insertion order is preserved within each priority by Map semantics.
  const entriesByContainerId = new Map<string, ReconcileQueueEntry>();

  const takeByPriority = (priority: ReconcilePriority): string | null => {
    for (const entry of entriesByContainerId.values()) {
      if (entry.priority === priority) {
        entriesByContainerId.delete(entry.containerId);
        return entry.containerId;
      }
    }
    return null;
  };

  return {
    enqueue: (containerId, priority) => {
      const existing = entriesByContainerId.get(containerId);
      if (existing) {
        if (priority === "active" && existing.priority === "idle") {
          existing.priority = "active";
        }
        return;
      }
      entriesByContainerId.set(containerId, { containerId, priority });
    },
    dequeue: () => takeByPriority("active") ?? takeByPriority("idle"),
    get size() {
      return entriesByContainerId.size;
    },
    clear: () => entriesByContainerId.clear(),
  };
}
