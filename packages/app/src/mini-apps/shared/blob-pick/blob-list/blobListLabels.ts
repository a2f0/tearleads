// Self-contained labels for the shared blob-list surface. Kept independent of
// any mini-app's label catalog so the surface can render in the Explorer and the
// Notes mini-app alike without importing across a mini-app boundary. A handful of
// strings intentionally mirror EXPLORER_LABELS — the two are separate UI
// namespaces and may diverge.
export const BLOB_LIST_LABELS = {
  blobColumn: "Blob",
  columnsMenuButton: "Columns",
  columnsMenuStateOff: "Off",
  columnsMenuStateOn: "On",
  columnSortedAscending: "sorted ascending",
  columnSortedDescending: "sorted descending",
  empty: "No blobs.",
  loading: "Loading...",
  mimeTypeColumn: "MIME",
  organizationColumn: "Organization",
  pickCancelAction: "Cancel",
  pickTitle: "Choose Blob",
  pickUnavailableHint: "Only image blobs can be attached.",
  referenceColumn: "References",
  searchPlaceholder: "Search blobs, storage keys, documents, or slots",
  sizeColumn: "Size",
  sortMenuLabel: "Sort blobs",
  sortReverseAction: "Reverse order",
  syncColumn: "Sync",
  title: "Blob Browser",
  updatedColumn: "Updated",
} as const;

const BLOB_LIST_COUNT_FORMATTER = new Intl.NumberFormat();
const BLOB_LIST_PLURAL_RULES = new Intl.PluralRules();

export function getBlobListReferenceCountLabel(value: number): string {
  const plural =
    BLOB_LIST_PLURAL_RULES.select(value) === "one" ? "reference" : "references";
  return `${BLOB_LIST_COUNT_FORMATTER.format(value)} ${plural}`;
}

export function getBlobListPickSubtitle(slotLabel: string): string {
  return `Choose an image blob for ${slotLabel}.`;
}
