import { DEFAULT_DOCUMENT_KIND } from "../../../../data/documents/documentConstants";
import { writeStoredDocumentFields } from "../../../../data/documents/documentKinds";
import {
  addDocumentRow,
  createDocumentRowId,
} from "../../../../data/documents/documentRowList";
import type { DocumentStructuredFieldPatch } from "../../types";
import { resolveRowAttribution } from "../rows/rowAttribution";
import type { DocumentState, DocumentStoreState } from "../state";

// A fresh doc has nothing to delete, and a delete of an absent key would still
// cost an op, so only the fields that set a value are written.
function definedStructuredFields(
  patch: DocumentStructuredFieldPatch | undefined,
): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Rejects initial fields a store could never write, at open rather than in the
 * fire-and-forget initialization: like `setStructuredFields`, fields belong to
 * a structured (non-note) kind.
 */
export function assertInitialContentFitsKind(
  initialContent: DocumentStoreState["initialContent"],
  initialDocumentKind: DocumentStoreState["initialDocumentKind"],
): void {
  if (
    initialDocumentKind === DEFAULT_DOCUMENT_KIND &&
    definedStructuredFields(initialContent?.initialStructuredFields)
  ) {
    throw new Error("Initial structured fields need a structured kind");
  }
}

/**
 * Writes the fields and rows a created record starts with into its birth doc,
 * beside the initial kind and text, so they share the birth's single update
 * (and through it a seeded create, or the attach a deferred birth waits for).
 * Rows are stamped exactly as `addRow` stamps them. Returns whether anything
 * was written.
 */
export function writeInitialDocumentContent(
  state: DocumentStoreState,
  doc: DocumentState,
): boolean {
  const fields = definedStructuredFields(
    state.initialContent?.initialStructuredFields,
  );
  if (fields) {
    writeStoredDocumentFields(
      doc,
      state.initialDocumentKind,
      fields,
      state.runtime.infra.documentProjectors,
    );
  }
  const rows = state.initialContent?.initialRows ?? [];
  for (const row of rows) {
    addDocumentRow(
      doc,
      createDocumentRowId(),
      row,
      resolveRowAttribution(state),
    );
  }
  return fields !== null || rows.length > 0;
}
