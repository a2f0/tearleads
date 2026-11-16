import {
  type DocumentProjectorRegistryInput,
  readStoredDocumentState,
  type StructuredDocumentShape,
  writeStoredDocumentFields,
} from "./documentKinds";
import {
  addDocumentRow,
  type DocumentRowAttribution,
  listDocumentRows,
  removeDocumentRow,
  setDocumentRowFields,
} from "./documentRowList";

/**
 * The content of a document that a restore writes back: its text, structured
 * fields, and rows. Attachments are not part of it. Their bytes are not kept
 * once detached, so a restore leaves the document's attachments as they are.
 */
export interface DocumentRestoreContent {
  readonly rows: ReadonlyArray<{
    readonly fields: Readonly<Record<string, string>>;
    readonly id: string;
  }>;
  readonly structuredFields: Readonly<Record<string, string>>;
  readonly text: string;
}

type RestoreRow = DocumentRestoreContent["rows"][number];

/** A document whose text can be replaced, as a Loro document's can. */
type RestorableDocument = Omit<StructuredDocumentShape, "getText"> & {
  getText: (key: string) => {
    toString: () => string;
    update: (text: string) => void;
  };
};

function restoreText(doc: RestorableDocument, text: string): boolean {
  const current = doc.getText("text");
  if (current.toString() === text) return false;
  current.update(text);
  return true;
}

function restoreStructuredFields(
  doc: StructuredDocumentShape,
  target: Readonly<Record<string, string>>,
  registry: DocumentProjectorRegistryInput | undefined,
): boolean {
  const current = readStoredDocumentState(doc, registry);
  // A note has no structured fields to restore.
  if (current.documentKind === "note") return false;
  const patch: Record<string, string | undefined> = {};
  for (const key of new Set([
    ...Object.keys(current.structuredFields),
    ...Object.keys(target),
  ])) {
    if (current.structuredFields[key] !== target[key]) {
      patch[key] = target[key];
    }
  }
  if (Object.keys(patch).length === 0) return false;
  writeStoredDocumentFields(doc, current.documentKind, patch, registry);
  return true;
}

/** The cells to write so `current` matches `target`, or null when a cell must be cleared. */
function rowCellPatch(
  current: Readonly<Record<string, string>>,
  target: Readonly<Record<string, string>>,
): Record<string, string> | null {
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(target)) {
    if (current[key] !== value) patch[key] = value;
  }
  // A row write sets cells but cannot clear one: such a row is rebuilt.
  return Object.keys(current).every((key) => key in target) ? patch : null;
}

/**
 * Make the document's rows equal `target`, in order. Rows that already lead
 * the list with the same ids are patched cell by cell, keeping every cell
 * that did not change. From the first row that differs in identity, or needs
 * a cell cleared, the rest are removed and added again under their own ids.
 */
function restoreRows(
  doc: StructuredDocumentShape,
  target: ReadonlyArray<RestoreRow>,
  attribution: DocumentRowAttribution,
): boolean {
  const current = listDocumentRows(doc);
  let changed = false;
  let kept = 0;
  for (; kept < target.length; kept += 1) {
    const row = current[kept];
    const wanted = target[kept];
    if (row === undefined || wanted === undefined || row.id !== wanted.id) {
      break;
    }
    const patch = rowCellPatch(row.fields, wanted.fields);
    if (patch === null) break;
    if (Object.keys(patch).length > 0) {
      setDocumentRowFields(doc, row.id, patch, attribution);
      changed = true;
    }
  }
  for (const row of current.slice(kept)) {
    removeDocumentRow(doc, row.id);
    changed = true;
  }
  for (const row of target.slice(kept)) {
    addDocumentRow(doc, row.id, row.fields, attribution);
    changed = true;
  }
  return changed;
}

/**
 * Write `content` into the document as ordinary edits and report whether
 * anything changed. Nothing is rewound: the document keeps its whole history
 * and gains the operations that carry it back to this content, so the restore
 * syncs and merges like any other edit.
 */
export function restoreDocumentContent(
  doc: RestorableDocument,
  content: DocumentRestoreContent,
  attribution: DocumentRowAttribution,
  registry?: DocumentProjectorRegistryInput | undefined,
): boolean {
  const textChanged = restoreText(doc, content.text);
  const fieldsChanged = restoreStructuredFields(
    doc,
    content.structuredFields,
    registry,
  );
  const rowsChanged = restoreRows(doc, content.rows, attribution);
  return textChanged || fieldsChanged || rowsChanged;
}
