import { and, eq } from "drizzle-orm";
import type { DocumentSummary } from "../../../documentSummary";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "../../../documents/documentKinds";
import { documentProjection, documents } from "../../../sqlite/schema";
import { DOCUMENTS_APP_KIND } from "./constants";

interface SelectedDocumentProjection {
  localId: string | null;
  documentId: string | null;
  containerId: string | null;
  documentKind: StoredDocumentKind;
  text: string;
  title: string;
  updatedAt: string;
  accessStateHash: string | null;
}

interface SelectedDocumentProjectionDetail {
  text: string;
  containerId: string | null;
  documentKind: StoredDocumentKind;
  title: string;
}

interface SelectedDocumentProjectionTimestamp {
  documentKind?: StoredDocumentKind;
  text?: string;
  title?: string;
  updatedAt: string;
}

export const documentSummarySelection = {
  localId: documentProjection.localId,
  documentId: documentProjection.documentId,
  containerId: documentProjection.containerId,
  documentKind: documentProjection.documentKind,
  text: documentProjection.text,
  title: documentProjection.title,
  updatedAt: documentProjection.updatedAt,
  accessStateHash: documents.accessStateHash,
};

export const documentSummaryJoin = and(
  eq(documents.appKind, DOCUMENTS_APP_KIND),
  eq(documents.localId, documentProjection.localId),
);

export function deriveDocumentTitle(text: string): string {
  return deriveStoredDocumentTitle(text);
}

function deriveDocumentKind(text: string): StoredDocumentKind {
  return deriveStoredDocumentKind(text);
}

export function mapDocumentSummary(
  row: SelectedDocumentProjection,
): DocumentSummary {
  const documentKind =
    row.documentKind === "note"
      ? deriveDocumentKind(row.text)
      : row.documentKind;
  return {
    accessStateHash: row.accessStateHash,
    id: row.localId ?? "",
    containerId: row.containerId,
    documentKind,
    documentId: row.documentId,
    title: getProjectionTitle(row),
    updatedAt: row.updatedAt,
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
  return row?.documentKind ?? "note";
}

export function getProjectionTitle(
  row:
    | SelectedDocumentProjectionDetail
    | SelectedDocumentProjectionTimestamp
    | undefined,
): string {
  const title = row?.title ?? "";
  if (title.length > 0 && title !== getUntitledDocumentTitle("note")) {
    return title;
  }

  return deriveDocumentTitle(row?.text ?? "");
}

export function getProjectionUpdatedAt(
  row: SelectedDocumentProjectionTimestamp | undefined,
): string {
  return row?.updatedAt ?? "";
}
