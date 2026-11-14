import type { LocalProjectionView } from "@tearleads/client-sdk";

type DiscoveryView = Pick<LocalProjectionView, "getSnapshot" | "subscribe">;

function identitySnapshot(view: DiscoveryView) {
  const snapshot = view.getSnapshot();
  const rows = new Set<string>();
  for (const [bucket, summaries] of snapshot.documentSummariesByContainerId) {
    rows.add(JSON.stringify([bucket]));
    for (const row of summaries) {
      rows.add(
        JSON.stringify([bucket, row.id, row.documentId, row.containerId]),
      );
    }
  }
  return { ready: snapshot.ready, rows };
}

/** Discovery can bind a canonical stream before its kind/content is known. */
export function subscribeToSelfContactIdentityDiscovery(
  view: DiscoveryView,
  listener: () => void,
): () => void {
  let observed = identitySnapshot(view);
  return view.subscribe(() => {
    const current = identitySnapshot(view);
    if (
      current.ready === observed.ready &&
      current.rows.size === observed.rows.size &&
      [...current.rows].every((row) => observed.rows.has(row))
    )
      return;
    observed = current;
    listener();
  });
}
