import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../data/documentSummary";

export function getOrphanedDocumentWhereSql(input: {
  documentIdSql: string;
  projectionAlias: string;
}): string {
  const { documentIdSql, projectionAlias } = input;
  return `
    ${projectionAlias}.container_id IS NULL
    AND (
      ${projectionAlias}.organization_id = ?
      OR ${projectionAlias}.organization_id IS NULL
      OR ${projectionAlias}.organization_id = ''
    )
    AND ${projectionAlias}.document_kind NOT IN (${HIDDEN_DOCUMENT_SUMMARY_KINDS.map(
      () => "?",
    ).join(", ")})
    AND (
      ${documentIdSql} IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM document_container_projection link
        WHERE link.document_id = ${documentIdSql}
      )
    )
  `;
}

export function getOrphanedDocumentQueryBind(
  currentOrganizationId: string | null | undefined,
): ReadonlyArray<string> {
  return [currentOrganizationId ?? "", ...HIDDEN_DOCUMENT_SUMMARY_KINDS];
}
