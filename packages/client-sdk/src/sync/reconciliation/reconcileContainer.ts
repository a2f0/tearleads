import type { ReconciliationHost } from "./serviceTypes";

export async function reconcileOneContainer(
  host: ReconciliationHost,
  containerId: string,
  options: { forceDocumentContentPull?: boolean } = {},
): Promise<boolean> {
  // A queued local root/system id can become stale before the document phase.
  if (!host.canDiscoverContainerDocuments(containerId)) {
    return false;
  }

  try {
    const discovered = await host.discoverContainerDocuments(containerId);
    if (discovered === null) {
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
    return true;
  } catch (error) {
    if (host.isIgnorableError(error)) {
      return false;
    }
    throw error;
  }
}
