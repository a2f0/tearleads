import { and, eq } from "drizzle-orm";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "../../../documents/documentKinds";
import type { DocumentSummary } from "../../../documents/shared/documentSummary";
import { documentProjection, documents } from "../../../sqlite/schema";
import { DOCUMENTS_APP_KIND } from "./constants";

interface SelectedDocumentProjection {
  localId: string | null;
  documentId: string | null;
  containerId: string | null;
  text: string;
  updatedAt: string;
  accessStateHash: string | null;
}

interface SelectedDocumentProjectionDetail {
  text: string;
  containerId: string | null;
}

interface SelectedDocumentProjectionTimestamp {
  text?: string;
  updatedAt: string;
}

export const documentSummarySelection = {
  localId: documentProjection.localId,
  documentId: documentProjection.documentId,
  containerId: documentProjection.containerId,
  text: documentProjection.text,
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

export function deriveDocumentKind(text: string): StoredDocumentKind {
  return deriveStoredDocumentKind(text);
}

export function mapDocumentSummary(
  row: SelectedDocumentProjection,
): DocumentSummary {
  return {
    accessStateHash: row.accessStateHash,
    id: row.localId ?? "",
    containerId: row.containerId,
    documentKind: deriveDocumentKind(row.text),
    documentId: row.documentId,
    title: deriveDocumentTitle(row.text),
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

export function getProjectionUpdatedAt(
  row: SelectedDocumentProjectionTimestamp | undefined,
): string {
  return row?.updatedAt ?? "";
}
