import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containers,
} from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import { uuidValue } from "../../../../utils/sqlDialect";

/**
 * The organization grants listing (`organizations/containerGrants.ts`) shows a
 * container only while its current manifest head has direct grants, and lists
 * that head, its metadata document, and the container's parent and depth. A
 * manifest advance can therefore change the listing only when the previous or
 * the next manifest grants directly; any other advance leaves every listed row
 * identical and must not stamp the grants lane.
 */
export function manifestAdvanceChangesGrantsListing(
  previousManifest: VerifiedContainerAccessManifest | null,
  manifest: VerifiedContainerAccessManifest,
): boolean {
  return (
    (previousManifest?.state.directGrants.length ?? 0) > 0 ||
    manifest.state.directGrants.length > 0
  );
}

/**
 * A move also rewrites the depth of every descendant. Whether any descendant
 * is listed: its current manifest head has grant projection rows.
 */
export async function descendantsIncludeListedGrant(
  executor: DatabaseTransaction,
  containerId: string,
): Promise<boolean> {
  const result = await executor.execute(sql`
    with recursive descendants as (
      select ${containers.id} as id
      from ${containers}
      where ${containers.parentId} = ${uuidValue(containerId)}
      union all
      select child.id
      from ${containers} child
      inner join descendants on child.parent_id = descendants.id
    )
    select 1 as listed
    from descendants
    inner join ${accessManifestHeads}
      on ${accessManifestHeads.objectKind} = ${"container"}
      and ${accessManifestHeads.objectId} = descendants.id
    inner join ${accessManifestContainerGrantProjection}
      on ${accessManifestContainerGrantProjection.containerId} = descendants.id
      and ${accessManifestContainerGrantProjection.manifestHash} = ${accessManifestHeads.manifestHash}
    limit 1
  `);
  return result.rows.length > 0;
}
