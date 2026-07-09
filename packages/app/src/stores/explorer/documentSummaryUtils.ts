import type { DocumentSummary } from "@tearleads/client-sdk";

function areDocumentSummariesEqualForExplorerMerge(
  left: DocumentSummary,
  right: DocumentSummary,
) {
  return (
    left.title === right.title &&
    (left.accessStateHash ?? null) === (right.accessStateHash ?? null) &&
    left.containerId === right.containerId &&
    left.documentKind === right.documentKind &&
    left.documentId === right.documentId
  );
}

export function mergeSingleDocumentSummaryList(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocument: DocumentSummary,
): ReadonlyArray<DocumentSummary> {
  const existingDocumentIndex = currentDocumentSummaries.findIndex(
    (documentSummary) => documentSummary.id === nextDocument.id,
  );

  if (existingDocumentIndex < 0) {
    return [...currentDocumentSummaries, nextDocument];
  }

  const existingDocument = currentDocumentSummaries[existingDocumentIndex];
  if (!existingDocument) {
    return currentDocumentSummaries;
  }

  if (
    areDocumentSummariesEqualForExplorerMerge(existingDocument, nextDocument)
  ) {
    return currentDocumentSummaries;
  }

  const nextDocumentSummaries = [...currentDocumentSummaries];
  nextDocumentSummaries[existingDocumentIndex] = nextDocument;
  return nextDocumentSummaries;
}

// Fold a coalesced burst of tracked subscription deltas into the listed
// summaries. Like the immediate tracked path, it only updates documents already
// in the list (never appends) and returns the same array reference when nothing
// changed, so consumers re-render only on a real change.
export function applyTrackedDocumentSummaryUpdates(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  updates: ReadonlyArray<DocumentSummary>,
): ReadonlyArray<DocumentSummary> {
  let nextDocumentSummaries = currentDocumentSummaries;
  for (const nextDocument of updates) {
    if (
      nextDocumentSummaries.some(
        (currentDocument) => currentDocument.id === nextDocument.id,
      )
    ) {
      nextDocumentSummaries = mergeSingleDocumentSummaryList(
        nextDocumentSummaries,
        nextDocument,
      );
    }
  }

  return nextDocumentSummaries;
}

export function getRequestedDocumentIds(
  documentSummaries: ReadonlyArray<DocumentSummary>,
): ReadonlyArray<string> {
  return Array.from(
    new Set(
      documentSummaries.flatMap((documentSummary) =>
        documentSummary.documentId ? [documentSummary.documentId] : [],
      ),
    ),
  ).sort();
}

// A stable signature of which documents belong to which container. Used to bump
// the DESTRUCTIVE link projection (which clears sidebar/table rows to a loading
// state) only on genuine membership changes — discovery, move, delete — and never
// on a content-only summary update (title, sync badge), which leaves every id in
// place. Ids and containers are sorted so ordering churn does not register, and
// keyed by the always-present summary id (per-container stable) rather than the
// nullable documentId. Bumping this on every reconciled delta is what re-blanked
// the "You"/system-folder rows each sync tick during bootstrap.
export function computeContainerMembershipSignature(
  documentSummariesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >,
): string {
  return Array.from(documentSummariesByContainerId.entries())
    .map(
      ([containerId, summaries]) =>
        `${containerId}:${summaries
          .map((summary) => summary.id)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join("\u0000");
}

export function areLinkedContainerIdMapsEqual(
  left: ReadonlyMap<string, ReadonlyArray<string>>,
  right: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [documentId, leftContainerIds] of left) {
    const rightContainerIds = right.get(documentId);
    if (
      !rightContainerIds ||
      leftContainerIds.length !== rightContainerIds.length
    ) {
      return false;
    }

    if (
      leftContainerIds.some(
        (containerId, index) => containerId !== rightContainerIds[index],
      )
    ) {
      return false;
    }
  }

  return true;
}

export function mergeDocumentSummaryLists(
  currentDocumentSummaries: ReadonlyArray<DocumentSummary>,
  nextDocuments: ReadonlyArray<DocumentSummary>,
): ReadonlyArray<DocumentSummary> {
  if (nextDocuments.length === 0) {
    return currentDocumentSummaries;
  }

  let changed = false;
  const nextDocumentSummaries = [...currentDocumentSummaries];

  for (const nextDocument of nextDocuments) {
    const existingDocumentIndex = nextDocumentSummaries.findIndex(
      (documentSummary) => documentSummary.id === nextDocument.id,
    );

    if (existingDocumentIndex < 0) {
      nextDocumentSummaries.push(nextDocument);
      changed = true;
      continue;
    }

    const existingDocument = nextDocumentSummaries[existingDocumentIndex];
    if (
      !existingDocument ||
      areDocumentSummariesEqualForExplorerMerge(existingDocument, nextDocument)
    ) {
      continue;
    }

    nextDocumentSummaries[existingDocumentIndex] = nextDocument;
    changed = true;
  }

  return changed ? nextDocumentSummaries : currentDocumentSummaries;
}
