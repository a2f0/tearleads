import { emptyVersionVector } from "@tearleads/loro";

// Discovery persists a shell before its first content pull. Keep those rows
// available to sync, but out of Explorer's selectable, paginated projections.
export function emptyContentFrontierSql(alias: string): string {
  return `(${alias}.snapshot_end_version = '' OR (${alias}.app_kind = 'container-metadata' AND ${alias}.snapshot_end_version = '${emptyVersionVector()}'))`;
}

export function hydratedProjectionSql(
  localId: string,
  appKind: "documents" | "container-metadata",
): string {
  return `NOT EXISTS (
    SELECT 1 FROM documents hydration
    WHERE hydration.app_kind = '${appKind}'
      AND hydration.local_id = ${localId}
      AND hydration.document_id IS NOT NULL
      AND ${emptyContentFrontierSql("hydration")}
  )`;
}
