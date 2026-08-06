import { and, eq } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../../../accessLevel";
import { DEFAULT_DOCUMENT_KIND } from "../../../documents/documentConstants";
import {
  deriveStoredDocumentTitle,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "../../../documents/documentKinds";
import type { DocumentSummary } from "../../../documents/documentSummary";
import { documentProjection, documents } from "../../../sqlite/schema";
import type { StoredDocumentRecord } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";

interface SelectedDocumentProjection {
  localId: string | null;
  documentId: string | null;
  containerId: string | null;
  documentKind: StoredDocumentKind;
  title: string;
  updatedAt: string;
  accessStateHash: string | null;
  effectiveAccessLevel: string | null;
}

interface SelectedDocumentProjectionDetail {
  text: string | null;
  containerId: string | null;
  documentKind: StoredDocumentKind;
  title: string;
}

interface SelectedDocumentProjectionTimestamp {
  documentKind?: StoredDocumentKind;
  text?: string | null;
  title?: string;
  updatedAt: string;
}

// Deliberately excludes the projected text (`documentProjectionText`): the
// title fallback is derived at write time, so summary listings never need to
// haul content-sized values through the worker.
export const documentSummarySelection = {
  localId: documentProjection.localId,
  documentId: documentProjection.documentId,
  containerId: documentProjection.containerId,
  documentKind: documentProjection.documentKind,
  title: documentProjection.title,
  updatedAt: documentProjection.updatedAt,
  accessStateHash: documents.accessStateHash,
  effectiveAccessLevel: documents.effectiveAccessLevel,
};

export const documentSummaryJoin = and(
  eq(documents.appKind, DOCUMENTS_APP_KIND),
  eq(documents.localId, documentProjection.localId),
);

export function deriveDocumentTitle(text: string): string {
  return deriveStoredDocumentTitle(text);
}

export function mapDocumentSummary(
  row: SelectedDocumentProjection,
): DocumentSummary {
  return {
    accessStateHash: row.accessStateHash,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      row.effectiveAccessLevel,
    ),
    id: row.localId ?? "",
    containerId: row.containerId,
    documentKind: row.documentKind,
    documentId: row.documentId,
    title: getProjectionTitle(row),
    updatedAt: row.updatedAt,
  };
}

export function toDocumentSummary(
  record: StoredDocumentRecord,
  updatedAt: string,
): DocumentSummary {
  return {
    accessStateHash: record.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      record.effectiveAccessLevel,
    ),
    id: record.id,
    containerId: record.containerId,
    documentKind: record.documentKind ?? DEFAULT_DOCUMENT_KIND,
    documentId: record.documentId,
    title: record.title ?? deriveDocumentTitle(record.text),
    updatedAt,
  };
}

export function getProjectionText(
  row:
    | SelectedDocumentProjectionDetail
    | SelectedDocumentProjectionTimestamp
    | undefined,
): string {
  return row?.text ?? "";
}

export function getProjectionContainerId(
  row: SelectedDocumentProjectionDetail | undefined,
): string | null {
  return row?.containerId ?? null;
}

export function getProjectionDocumentKind(
  row:
    | SelectedDocumentProjectionDetail
    | SelectedDocumentProjectionTimestamp
    | undefined,
): StoredDocumentKind {
  return row?.documentKind ?? DEFAULT_DOCUMENT_KIND;
}

export function getProjectionTitle(
  row:
    | SelectedDocumentProjectionDetail
    | SelectedDocumentProjectionTimestamp
    | undefined,
): string {
  const title = row?.title ?? "";
  if (
    title.length > 0 &&
    title !== getUntitledDocumentTitle(DEFAULT_DOCUMENT_KIND)
  ) {
    return title;
  }

  return deriveDocumentTitle(row?.text ?? "");
}

export function getProjectionUpdatedAt(
  row: SelectedDocumentProjectionTimestamp | undefined,
): string {
  return row?.updatedAt ?? "";
}
