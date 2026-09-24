import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../data/documents/documentSummary";

export function getOrphanedDocumentWhereSql(input: {
  documentIdSql: string;
  projectionAlias: string;
}): string {
  const { documentIdSql, projectionAlias } = input;
  return `
    (
      ${projectionAlias}.container_id IS NULL
      OR EXISTS (
        SELECT 1 FROM container_document_tombstone_holds primary_hold
        WHERE primary_hold.document_id = ${documentIdSql}
          AND primary_hold.container_id = ${projectionAlias}.container_id
          AND primary_hold.hidden = 1
      )
    )
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
          AND NOT EXISTS (
            SELECT 1 FROM container_document_tombstone_holds link_hold
            WHERE link_hold.document_id = link.document_id
              AND link_hold.container_id = link.container_id
              AND link_hold.hidden = 1
          )
      )
    )
  `;
}

export function getOrphanedDocumentQueryBind(
  currentOrganizationId: string | null | undefined,
): ReadonlyArray<string> {
  return [currentOrganizationId ?? "", ...HIDDEN_DOCUMENT_SUMMARY_KINDS];
}
