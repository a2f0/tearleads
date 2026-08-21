import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
} from "@symcrypt/api-shared/schema";
import { sql } from "drizzle-orm";
import { uuidValue } from "../../utils/sqlDialect";

type ManagedPrincipalType = "group" | "organization";

async function hasCurrentContainerGrantForPrincipalOrAncestor(input: {
  readonly executor: DatabaseTransaction;
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
}): Promise<boolean> {
  const result = await input.executor.execute(sql`
    -- Just this principal. It used to also walk upward through containing
    -- principals; principals contain only users now, so nothing contains it.
    with affected_principals(principal_type, principal_id) as (
      select ${input.principalType}, ${uuidValue(input.principalId)}
    )
    select 1
    from affected_principals affected
    inner join ${accessManifestContainerGrantProjection} grant_projection
      on grant_projection.subject_type = affected.principal_type
      and grant_projection.subject_id = affected.principal_id
    inner join ${accessManifestHeads} manifest_head
      on manifest_head.object_kind = ${"container"}
      and manifest_head.object_id = grant_projection.container_id
      and manifest_head.manifest_hash = grant_projection.manifest_hash
    limit 1
  `);

  return result.rows.length > 0;
}

export async function listPrincipalPolicyAccessGainNotificationUserIds(input: {
  readonly currentReachableUserIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly previousReachableUserIds: readonly string[];
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
}): Promise<string[]> {
  const previousUserIds = new Set(input.previousReachableUserIds);
  const addedUserIds = [...new Set(input.currentReachableUserIds)]
    .filter((userId) => !previousUserIds.has(userId))
    .sort();
  if (addedUserIds.length === 0) {
    return [];
  }

  const grantsAccess = await hasCurrentContainerGrantForPrincipalOrAncestor({
    executor: input.executor,
    principalId: input.principalId,
    principalType: input.principalType,
  });
  return grantsAccess ? addedUserIds : [];
}
