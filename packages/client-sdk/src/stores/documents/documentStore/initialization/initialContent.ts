import { DEFAULT_DOCUMENT_KIND } from "../../../../data/documents/documentConstants";
import { writeStoredDocumentFields } from "../../../../data/documents/documentKinds";
import {
  addDocumentRow,
  createDocumentRowId,
} from "../../../../data/documents/documentRowList";
import type {
  DocumentStoreJoiningOpen,
  DocumentStoreOpenOptions,
  DocumentStructuredFieldPatch,
} from "../../types";
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
 * Records what an open asks a created record to start with. An open with
 * `createIfMissing: false` asks for no record, so initialization leaves a
 * missing one missing until an open that may create joins the store.
 */
export function applyDocumentStoreCreationOptions(
  state: Pick<
    DocumentStoreState,
    | "createIfMissing"
    | "deferInitialUpdate"
    | "initialContent"
    | "initialDocumentKind"
  >,
  options: DocumentStoreOpenOptions,
): void {
  const { initialRows, initialStructuredFields } = options;
  assertInitialContentFitsKind(
    { initialStructuredFields },
    state.initialDocumentKind,
  );
  state.initialContent = { initialRows, initialStructuredFields };
  if (options.deferInitialUpdate) state.deferInitialUpdate = true;
  if (options.createIfMissing === false) state.createIfMissing = false;
}

/**
 * An open that may create joins a store whose openers so far only read. The
 * readers set no content for a record, so a record still missing is created
 * from this open's kind, text and content. It runs inside the open, so an
 * initialization already in flight sees it before deciding to create.
 */
export function joinDocumentStoreCreation(
  state: DocumentStoreState,
  open: DocumentStoreJoiningOpen,
): void {
  if (
    state.createIfMissing !== false ||
    open.options.createIfMissing === false
  ) {
    return;
  }
  assertInitialContentFitsKind(open.options, open.initialDocumentKind);
  state.createIfMissing = undefined;
  state.initialDocumentKind = open.initialDocumentKind;
  state.initialText = open.initialText;
  applyDocumentStoreCreationOptions(state, open.options);
}

/**
 * Writes the fields and rows a created record starts with into its birth doc,
 * beside the initial kind and text, so they share the birth's single update
 * (and through it a seeded create, or the attach a deferred birth waits for).
 * Rows are stamped exactly as `addRow` stamps them. Returns whether anything
 * was written.
 */
export function writeInitialDocumentContent(
  state: Pick<
    DocumentStoreState,
    "initialContent" | "initialDocumentKind" | "runtime"
  >,
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
