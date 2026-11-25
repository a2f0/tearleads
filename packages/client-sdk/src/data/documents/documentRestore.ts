import { type createDocument, getTextValue, updateText } from "@tearleads/loro";
import {
  type DocumentProjectorRegistryInput,
  readStoredDocumentState,
  type StructuredDocumentShape,
  writeStoredDocumentFields,
} from "./documentKinds";
import {
  addDocumentRow,
  createDocumentRowId,
  type DocumentRowAttribution,
  listDocumentRows,
  removeDocumentRow,
  replaceDocumentRowFields,
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

type RestorableDocument = Awaited<ReturnType<typeof createDocument>>;

function restoreText(doc: RestorableDocument, text: string): boolean {
  if (getTextValue(doc) === text) return false;
  // Bounded: a version from before a whole-text replacement differs
  // throughout from the text it replaces.
  updateText(doc, text);
  return true;
}

/** A field's own value: never a method every object inherits. */
function ownField(
  fields: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.hasOwn(fields, key) ? fields[key] : undefined;
}

function restoreStructuredFields(
  doc: StructuredDocumentShape,
  target: Readonly<Record<string, string>>,
  registry: DocumentProjectorRegistryInput | undefined,
): boolean {
  const current = readStoredDocumentState(doc, registry);
  // A note has no structured fields to restore.
  if (current.documentKind === "note") return false;
  // Read both sides by own key only. A field named `constructor` or
  // `toString` that the restored version lacks would otherwise read as the
  // inherited function, which is neither "absent" nor a value Loro can store.
  const changes: Array<[string, string | undefined]> = [];
  for (const key of new Set([
    ...Object.keys(current.structuredFields),
    ...Object.keys(target),
  ])) {
    const wanted = ownField(target, key);
    if (ownField(current.structuredFields, key) !== wanted) {
      changes.push([key, wanted]);
    }
  }
  if (changes.length === 0) return false;
  // fromEntries defines every key as an own property, `__proto__` included.
  writeStoredDocumentFields(
    doc,
    current.documentKind,
    Object.fromEntries(changes),
    registry,
  );
  return true;
}

/**
 * Make the document's rows equal `target`. A row that still exists is patched
 * cell by cell under its own id, a row that is gone from `target` is removed,
 * and a row the document no longer has is added back as a new row with a new
 * id, at the end.
 *
 * The new id is what keeps a restore safe to merge: two devices restoring the
 * same version at once each add their own copy, and both copies stay distinct
 * rows that can be edited or removed. Re-adding under the old id would leave
 * two rows sharing it, with writes reaching only the first. Row order is not
 * restored, because a row cannot be moved.
 */
function restoreRows(
  doc: StructuredDocumentShape,
  target: ReadonlyArray<RestoreRow>,
  attribution: DocumentRowAttribution,
): boolean {
  const current = listDocumentRows(doc);
  const targetById = new Map(target.map((row) => [row.id, row]));
  const currentIds = new Set(current.map((row) => row.id));
  let changed = false;
  for (const row of current) {
    const wanted = targetById.get(row.id);
    if (wanted === undefined) {
      changed = removeDocumentRow(doc, row.id) || changed;
    } else {
      changed =
        replaceDocumentRowFields(doc, row.id, wanted.fields, attribution) ||
        changed;
    }
  }
  for (const row of target) {
    if (!currentIds.has(row.id)) {
      addDocumentRow(doc, createDocumentRowId(), row.fields, attribution);
      changed = true;
    }
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
