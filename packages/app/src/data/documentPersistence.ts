import type { SqlRow } from "./AppDataProvider";
import { readSqlRowValue } from "./sqlSchema";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
}

export function parseDocumentRecord(row: SqlRow): DocumentRecord {
  const id = readSqlRowValue(row, "id");
  const documentId = readSqlRowValue(row, "document_id");
  const loroSnapshot = readSqlRowValue(row, "loro_snapshot");
  const accessEpoch = readSqlRowValue(row, "access_epoch");

  return {
    id: String(id ?? ""),
    documentId: documentId === null ? null : String(documentId),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
  };
}

export function parsePendingUpdateRecord(row: SqlRow): PendingUpdateRecord {
  const id = readSqlRowValue(row, "id");
  const updateData = readSqlRowValue(row, "update_data");
  const partialStartVersionVector = readSqlRowValue(
    row,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readSqlRowValue(
    row,
    "partial_end_version_vector",
  );

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
    partialStartVersionVector: String(partialStartVersionVector ?? ""),
    partialEndVersionVector: String(partialEndVersionVector ?? ""),
  };
}
