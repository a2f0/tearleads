import type {
  ContainerDiscoveryOutcome,
  ReconciliationHost,
} from "./serviceTypes";

export interface ContainerReconcileEntry {
  readonly containerId: string;
  readonly documentIds?: ReadonlySet<string> | undefined;
  readonly forceDocumentContentPull: boolean;
  readonly onFullListing?:
    | ((documentIds: ReadonlyArray<string>) => void)
    | undefined;
  readonly onPendingDiscovery?: ((delayMs: number) => void) | undefined;
}

export type ContainerReconcileResult =
  | { readonly containerId: string; readonly status: "reconciled" | "skipped" }
  | {
      readonly containerId: string;
      readonly error: unknown;
      readonly status: "failed";
    };

async function settleDiscoveredContainer(
  host: ReconciliationHost,
  entry: ContainerReconcileEntry,
  outcome: ContainerDiscoveryOutcome,
  pending: boolean,
): Promise<ContainerReconcileResult> {
  const { containerId } = entry;
  try {
    if (outcome.status === "rejected") throw outcome.reason;
    if (outcome.value === null && !pending) {
      return { containerId, status: "skipped" };
    }
    const delta = await host.loadContainerDelta(containerId);
    host.applyReconciled(delta);
    // Hint forces target named documents. Full refreshes revalidate every
    // registered store; passive pulls only open system projections.
    host.requestDocumentContentPull(
      containerId,
      delta.documentSummaries,
      entry.forceDocumentContentPull,
      entry.documentIds,
    );
    // A durable, scheduled retry is settled for this sweep and force request.
    // Its own timer will reopen the lane when evidence is due.
    return { containerId, status: "reconciled" };
  } catch (error) {
    return host.isIgnorableError(error)
      ? { containerId, status: "skipped" }
      : { containerId, error, status: "failed" };
  }
}

/**
 * Lists every entry's documents in one batched discovery, then reconciles each
 * container as soon as its lane applies. Results follow entry order; one
 * container's failure never hides another's result.
 */
export async function reconcileContainers(
  host: ReconciliationHost,
  entries: ReadonlyArray<ContainerReconcileEntry>,
): Promise<ReadonlyArray<ContainerReconcileResult>> {
  // A queued local root/system id can become stale before the document phase.
  const eligible = new Map(
    entries
      .filter((entry) => host.canDiscoverContainerDocuments(entry.containerId))
      .map((entry) => [entry.containerId, entry]),
  );
  const pending = new Set<string>();
  const results = new Map<string, ContainerReconcileResult>();
  const settle = async (outcome: ContainerDiscoveryOutcome) => {
    const entry = eligible.get(outcome.containerId);
    if (!entry || results.has(entry.containerId)) return;
    results.set(
      entry.containerId,
      await settleDiscoveredContainer(
        host,
        entry,
        outcome,
        pending.has(entry.containerId),
      ),
    );
  };
  if (eligible.size > 0) {
    try {
      const outcomes = await host.discoverContainerDocuments(
        [...eligible.values()].map((entry) => ({
          containerId: entry.containerId,
          onFullListing: entry.onFullListing,
          onPendingDiscovery: (delayMs: number) => {
            pending.add(entry.containerId);
            entry.onPendingDiscovery?.(delayMs);
          },
        })),
        settle,
      );
      for (const outcome of outcomes) await settle(outcome);
    } catch (reason) {
      for (const containerId of eligible.keys()) {
        await settle({ containerId, reason, status: "rejected" });
      }
    }
  }
  return entries.map(
    ({ containerId }) =>
      results.get(containerId) ?? { containerId, status: "skipped" },
  );
}
