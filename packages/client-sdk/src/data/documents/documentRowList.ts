import { type LoroList, LoroMap } from "@tearleads/loro";

// A document's repeated rows (e.g. a .env file's variables, a blood pressure
// tracker's readings) live in one first-class Loro list — each row a nested
// LoroMap. Storing each row as its own container makes concurrent edits to
// different rows (or different cells of the same row) merge instead of
// clobbering; only two writes to the same cell of the same row race, and Loro
// resolves those last-writer-wins.
const DOCUMENT_ROWS_LIST_KEY = "rows";

// Reserved row-map keys are namespaced so they never collide with a document
// type's own field names (none of which begin with "@").
const ROW_META_PREFIX = "@";
const ROW_ID_KEY = "@id";
const ROW_CREATED_BY_KEY = "@createdBy";
const ROW_CREATED_AT_KEY = "@createdAt";
const ROW_UPDATED_BY_KEY = "@updatedBy";
const ROW_UPDATED_AT_KEY = "@updatedAt";

export interface DocumentRowAttribution {
  // The signing user id of the writer, or "" when unauthenticated. Matches the
  // key the edit-attribution/blame layer resolves against.
  userId: string;
  // ISO-8601 timestamp of the write.
  at: string;
}

export interface DocumentRow {
  id: string;
  fields: Record<string, string>;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

// The minimal projection of a row the document projector needs to derive a
// title (e.g. a reading/variable count) without depending on the store.
export interface DocumentRowSummary {
  id: string;
  fields: Readonly<Record<string, string>>;
}

interface RowListDocumentShape {
  getList: (key: string) => LoroList;
}

let localRowIdCounter = 0;

export function createDocumentRowId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return randomId;
  }

  localRowIdCounter += 1;
  return `row-${Date.now()}-${localRowIdCounter}`;
}

function readRowString(row: LoroMap, key: string): string {
  const value = row.get(key);
  return typeof value === "string" ? value : "";
}

function parseDocumentRow(row: LoroMap): DocumentRow | null {
  const id = readRowString(row, ROW_ID_KEY);
  if (id.length === 0) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of row.entries()) {
    if (key.startsWith(ROW_META_PREFIX)) {
      continue;
    }
    if (typeof value === "string") {
      fields[key] = value;
    }
  }

  return {
    id,
    fields,
    createdBy: readRowString(row, ROW_CREATED_BY_KEY),
    createdAt: readRowString(row, ROW_CREATED_AT_KEY),
    updatedBy: readRowString(row, ROW_UPDATED_BY_KEY),
    updatedAt: readRowString(row, ROW_UPDATED_AT_KEY),
  };
}

export function ensureDocumentRowsStructure(doc: RowListDocumentShape): void {
  doc.getList(DOCUMENT_ROWS_LIST_KEY);
}

function findRowMap(list: LoroList, id: string): LoroMap | null {
  for (let index = 0; index < list.length; index += 1) {
    const value = list.get(index);
    if (value instanceof LoroMap && readRowString(value, ROW_ID_KEY) === id) {
      return value;
    }
  }

  return null;
}

export function listDocumentRows(doc: RowListDocumentShape): DocumentRow[] {
  const list = doc.getList(DOCUMENT_ROWS_LIST_KEY);
  const rows: DocumentRow[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const value = list.get(index);
    if (value instanceof LoroMap) {
      const row = parseDocumentRow(value);
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function writeRowFields(
  row: LoroMap,
  fields: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    // Never let a caller's field name overwrite reserved metadata.
    if (key.startsWith(ROW_META_PREFIX)) {
      continue;
    }
    row.set(key, value);
  }
}

export function addDocumentRow(
  doc: RowListDocumentShape,
  id: string,
  fields: Readonly<Record<string, string>>,
  attribution: DocumentRowAttribution,
): void {
  const list = doc.getList(DOCUMENT_ROWS_LIST_KEY);
  const row = list.pushContainer(new LoroMap());
  row.set(ROW_ID_KEY, id);
  row.set(ROW_CREATED_BY_KEY, attribution.userId);
  row.set(ROW_CREATED_AT_KEY, attribution.at);
  row.set(ROW_UPDATED_BY_KEY, attribution.userId);
  row.set(ROW_UPDATED_AT_KEY, attribution.at);
  writeRowFields(row, fields);
}

export function setDocumentRowFields(
  doc: RowListDocumentShape,
  id: string,
  patch: Readonly<Record<string, string>>,
  attribution: DocumentRowAttribution,
): boolean {
  const list = doc.getList(DOCUMENT_ROWS_LIST_KEY);
  const row = findRowMap(list, id);
  if (!row) {
    return false;
  }

  writeRowFields(row, patch);
  row.set(ROW_UPDATED_BY_KEY, attribution.userId);
  row.set(ROW_UPDATED_AT_KEY, attribution.at);
  return true;
}

export function removeDocumentRow(
  doc: RowListDocumentShape,
  id: string,
): boolean {
  const list = doc.getList(DOCUMENT_ROWS_LIST_KEY);
  for (let index = 0; index < list.length; index += 1) {
    const value = list.get(index);
    if (value instanceof LoroMap && readRowString(value, ROW_ID_KEY) === id) {
      list.delete(index, 1);
      return true;
    }
  }

  return false;
}

function sameRow(left: DocumentRow, right: DocumentRow): boolean {
  if (
    left.id !== right.id ||
    left.createdBy !== right.createdBy ||
    left.createdAt !== right.createdAt ||
    left.updatedBy !== right.updatedBy ||
    left.updatedAt !== right.updatedAt
  ) {
    return false;
  }

  const leftKeys = Object.keys(left.fields);
  const rightKeys = Object.keys(right.fields);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left.fields[key] === right.fields[key]);
}

export function sameDocumentRows(
  left: ReadonlyArray<DocumentRow>,
  right: ReadonlyArray<DocumentRow>,
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const nextRow = right[index];
      return nextRow !== undefined && sameRow(row, nextRow);
    })
  );
}
