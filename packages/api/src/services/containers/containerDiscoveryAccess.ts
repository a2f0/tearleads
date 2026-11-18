import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containers,
  principalMembershipProjection,
} from "@tearleads/api-shared/schema";
import { type SQL, sql } from "drizzle-orm";
import { uuidValue } from "../../utils/postgresSql";
import { currentPrincipalStateHashSql } from "../../workflows/principals/currentPrincipalStateSql";

export function discoveryGrantSubjects(userId: string): SQL {
  return sql`reachable_principals as (
      select
        pmp.principal_type,
        pmp.principal_id
      from ${principalMembershipProjection} pmp
      where
        pmp.user_id = ${uuidValue(userId)}
        and pmp.state_hash = ${currentPrincipalStateHashSql({
          principalId: sql`pmp.principal_id`,
          principalType: sql`pmp.principal_type`,
        })}
    ),
    grant_subjects as (
      select
        ${"user"} as principal_type,
        ${uuidValue(userId)} as principal_id
      union all
      select principal_type, principal_id from reachable_principals
    )`;
}

/** Older writers could leave a revocation after a move restored inherited access. */
export function containerHasDiscoveryAccess(containerId: SQL): SQL {
  return sql`exists (
    with recursive path as (
      select id, parent_id from ${containers} where id = ${containerId}
      union all
      select parent.id, parent.parent_id from path
      join ${containers} parent on parent.id = path.parent_id
    )
    select 1 from path
    join ${accessManifestHeads} head on head.object_kind = 'container' and head.object_id = path.id
    join ${accessManifestContainerGrantProjection} g on g.manifest_hash = head.manifest_hash
    join grant_subjects subject on subject.principal_type = g.subject_type and subject.principal_id = g.subject_id
  )`;
}
