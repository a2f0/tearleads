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

// A per-container membership signature: containerId -> a stable string of its
// document ids. Used to bump the DESTRUCTIVE link projection (which clears
// sidebar/table rows to a loading state) only on genuine membership changes —
// discovery, move, delete — and never on a content-only summary update (title,
// sync badge), which leaves every id in place. Ids are sorted so ordering churn
// does not register, and keyed by the always-present summary id (per-container
// stable) rather than the nullable documentId. Kept per container (not one global
// string) so callers can tell a real change to an existing container apart from a
// container key merely appearing for the first time — see
// hasTrackedContainerMembershipChange.
export function computeContainerMembershipSignatures(
  documentSummariesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >,
): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const [containerId, summaries] of documentSummariesByContainerId) {
    signatures.set(
      containerId,
      summaries
        .map((summary) => summary.id)
        .sort()
        .join(","),
    );
  }
  return signatures;
}

// Whether the DESTRUCTIVE sidebar/table refresh should fire between two membership
// snapshots. It fires when:
//   - this is the first snapshot (previous === null): the initial population runs;
//   - a container present in BOTH snapshots changed its id-set (real discovery /
//     move / delete inside a container already on screen); or
//   - a container present before is now ABSENT (a real drop / cache reset).
//
// It deliberately does NOT fire for a container key that appears for the FIRST
// time (present in next, absent in previous). The SDK's local projection cache
// materializes a container's summaries lazily — the first time that container
// becomes the active container — so a purely additive key means "we just loaded
// this container's list into the view", NOT "a document changed containers". The
// document was already visible in the sidebar (its rows come from the SQL window
// query, independent of this projection). Firing the destructive reload on that
// additive key blanked every expanded container — collapsing the Contacts folder
// and bouncing the Trash row up then down — when the user simply selected the
// "You" contact, whose Contacts container had not been materialized yet. A newly
// materialized container still populates non-destructively via the sidebar's own
// window loader, so nothing is stranded by skipping it here.
export function hasTrackedContainerMembershipChange(
  previous: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
): boolean {
  if (previous === null) {
    return true;
  }
  // Iterate the PREVIOUS keys only: a container that was present before either
  // changed its id-set (next has a different signature) or dropped out entirely
  // (next has none). Keys that exist only in `next` are the additive first
  // appearances we intentionally ignore.
  for (const [containerId, signature] of previous) {
    if (next.get(containerId) !== signature) {
      return true;
    }
  }
  return false;
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
