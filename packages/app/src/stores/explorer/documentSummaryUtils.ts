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

// A per-container membership signature: the document ids in each container. Used
// to bump the DESTRUCTIVE link projection (which clears sidebar rows to a loading
// state) only on genuine membership changes — discovery, move, delete — and never
// on a content-only summary update (title, sync badge), which leaves every id in
// place. Ids are sorted so ordering churn does not register, and keyed by the
// always-present summary id (per-container stable) rather than the nullable
// documentId. Per-container (not one global string) so a change in one org's
// container can be told apart from another's — the sidebar must blank only the
// container that actually changed, not every expanded container.
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

// The container ids that should get a DESTRUCTIVE sidebar refresh between two
// membership snapshots. Reports a container that was ALREADY present and changed
// its id-set (real discovery / move / delete on screen) or one that DROPPED OUT
// while HOLDING documents (a real removal / cache reset). Empty when only summary
// content changed (or nothing did), which keeps content-only reconciled deltas
// from blanking rows. An empty container (signature "") that drops out is NOT
// reported — it had no rows, so refreshing it would only cost a wasted reload.
//
// `previous === null` marks the FIRST apply (mount or a view rotation): every
// present container is reported so the initial population runs once.
//
// A container that appears for the FIRST time (present in next, absent from a
// non-null previous) is deliberately NOT reported. The SDK local-projection cache
// materializes a container's summaries lazily — the first time that container
// becomes the active container — so a purely additive key means "we just loaded
// this container's list into the view", NOT "a document changed containers". That
// document was already visible in the sidebar (its rows come from the SQL window
// query, independent of this projection). Reporting the additive key blanked the
// container — collapsing the Contacts folder and bouncing the Trash row up then
// down — when the user simply selected the "You" contact, whose Contacts container
// had not been materialized yet. A newly materialized container still populates
// non-destructively via the sidebar's own window loader, so nothing is stranded.
export function diffChangedContainerIds(
  previous: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
): string[] {
  if (previous === null) {
    return Array.from(next.keys());
  }
  const changed: string[] = [];
  for (const [containerId, signature] of next) {
    // Only containers already present whose id-set actually changed. A single get
    // suffices: values are always strings, so `undefined` means the key is absent
    // from `previous` — an additive first appearance we intentionally skip.
    const previousSignature = previous.get(containerId);
    if (previousSignature !== undefined && previousSignature !== signature) {
      changed.push(containerId);
    }
  }
  for (const [containerId, signature] of previous) {
    // A container that DROPS OUT of the map is reported only if it actually held
    // documents. An empty container (signature "") vanishing has no rows to blank,
    // so refreshing it would be a wasteful destructive reload — skip it, mirroring
    // the additive first-appearance skip above so only real membership changes fire.
    if (!next.has(containerId) && signature !== "") {
      changed.push(containerId);
    }
  }
  return changed;
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
