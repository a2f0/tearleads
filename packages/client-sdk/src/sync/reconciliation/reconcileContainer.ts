import type { ReconciliationHost } from "./serviceTypes";

export async function reconcileOneContainer(
  host: ReconciliationHost,
  containerId: string,
  options: {
    forceDocumentContentPull?: boolean;
    onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
    onPendingDiscovery?: ((delayMs: number) => void) | undefined;
  } = {},
): Promise<boolean> {
  // A queued local root/system id can become stale before the document phase.
  if (!host.canDiscoverContainerDocuments(containerId)) {
    return false;
  }

  try {
    let pending = false;
    const discovered = await host.discoverContainerDocuments(
      containerId,
      options.onFullListing,
      (delayMs) => {
        pending = true;
        options.onPendingDiscovery?.(delayMs);
      },
    );
    if (discovered === null && !pending) {
      return false;
    }
    const delta = await host.loadContainerDelta(containerId);
    host.applyReconciled(delta);
    // Forced pulls revalidate registered ordinary documents; unforced pulls
    // remain limited to unopened system projections.
    host.requestDocumentContentPull(
      containerId,
      delta.documentSummaries,
      options.forceDocumentContentPull ?? false,
    );
    // A durable, scheduled retry is settled for this sweep and force request.
    // Its own timer will reopen the lane when evidence is due.
    return true;
  } catch (error) {
    if (host.isIgnorableError(error)) {
      return false;
    }
    throw error;
  }
}
