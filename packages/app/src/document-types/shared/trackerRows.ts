import type { DocumentRow } from "@tearleads/client-sdk";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import type { RowDetailField } from "./DocumentRowDetail";

export type ReadTrackerRowCell = (
  id: string,
  field: string,
  storeValue: string,
) => string;

/** Metadata shared by every repeated row in a tracker document. */
export interface TrackerRow {
  id: string;
  createdAt: string;
  createdBy: string;
  createdByPeer: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedByPeer: string | null;
  fieldEditors: Record<string, string | null>;
}

export function trackerRowMetadata(row: DocumentRow): TrackerRow {
  return {
    id: row.id,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    createdByPeer: row.createdByPeer,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    updatedByPeer: row.updatedByPeer,
    fieldEditors: row.fieldEditors,
  };
}

/**
 * Reads one cell (a document field) through the caller's optimistic in-flight
 * overlay so controlled inputs stay smooth.
 */
export function readTrackerRowCell(
  row: DocumentRow,
  readCell: ReadTrackerRowCell,
  field: string,
): string {
  return readCell(row.id, field, row.fields[field] ?? "");
}

/**
 * Folds the store's generic rows into typed views: shared row metadata plus
 * the caller's typed cells (built via {@link readTrackerRowCell}).
 */
export function toTrackerRows<Cells extends Record<string, string>>(
  rows: ReadonlyArray<DocumentRow>,
  readRowCells: (row: DocumentRow) => Cells,
): Array<TrackerRow & Cells> {
  return rows.map((row) => ({
    ...trackerRowMetadata(row),
    ...readRowCells(row),
  }));
}

export function readStructuredTrackerField(
  structuredFields: Readonly<Record<string, string>>,
  field: string,
): string {
  const value = structuredFields[field];
  return typeof value === "string" ? value : "";
}

interface TrackerDetailField<Row extends TrackerRow> {
  field: string;
  label: string;
  value: (row: Row) => string;
}

export function trackerDetailFields<Row extends TrackerRow>(
  row: Row,
  fields: ReadonlyArray<TrackerDetailField<Row>>,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  return fields.map(({ field, label, value }) => ({
    label,
    value: value(row),
    writerUserId: resolveRowWriter?.(row.fieldEditors[field] ?? null) ?? null,
  }));
}

export function resolveTrackerRowWriter(
  peer: string | null,
  fallback: string,
  resolveRowWriter?: RowWriterResolver | undefined,
): string {
  return resolveRowWriter?.(peer) ?? fallback;
}
