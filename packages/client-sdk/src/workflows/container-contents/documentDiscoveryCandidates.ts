import type { DiscoveredDocumentCandidate } from "../../data/persistence/documents/documentDiscoveryEvidencePersistence";

export function groupPendingDocumentDiscoveries(
  candidates: readonly DiscoveredDocumentCandidate[],
) {
  const byDocument = new Map<string, DiscoveredDocumentCandidate[]>();
  for (const candidate of candidates) {
    const group = byDocument.get(candidate.documentId) ?? [];
    group.push(candidate);
    byDocument.set(candidate.documentId, group);
  }
  return [...byDocument.values()].map((rows) => {
    rows.sort(
      (a, b) =>
        b.accessEpoch - a.accessEpoch ||
        (a.containerId < b.containerId
          ? -1
          : a.containerId > b.containerId
            ? 1
            : 0),
    );
    const first = rows[0];
    if (!first) throw new Error("Empty discovery candidate group");
    return {
      rows,
      input: {
        ...first,
        listedContainerIds: [
          ...new Set(rows.flatMap((row) => row.listedContainerIds)),
        ].sort(),
      },
    };
  });
}
