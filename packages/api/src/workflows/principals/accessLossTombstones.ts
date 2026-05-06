import { sql } from "drizzle-orm";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import type { DatabaseTransaction } from "../../adapters/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containerSyncTombstones,
  containers,
  principalMembershipProjection,
  principalStates,
} from "../../schema";

interface PrincipalPolicyAccessLossRow {
  readonly containerId: string;
  readonly depth: number;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly userId: string;
}

function isPrincipalPolicyAccessLossRow(
  value: unknown,
): value is PrincipalPolicyAccessLossRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const containerId = Reflect.get(value, "containerId");
  const depth = Reflect.get(value, "depth");
  const organizationId = Reflect.get(value, "organizationId");
  const parentId = Reflect.get(value, "parentId");
  const userId = Reflect.get(value, "userId");

  return (
    typeof containerId === "string" &&
    Number.isInteger(depth) &&
    typeof organizationId === "string" &&
    (typeof parentId === "string" || parentId === null) &&
    typeof userId === "string"
  );
}

export async function persistPrincipalPolicyAccessLossTombstones(input: {
  readonly currentState: StoredPrincipalState;
  readonly executor: DatabaseTransaction;
  readonly previousState: StoredPrincipalState | null;
  readonly updatedAt: Date;
}): Promise<void> {
  const { currentState, executor, previousState, updatedAt } = input;
  if (!previousState || previousState.stateHash === currentState.stateHash) {
    return;
  }

  const result = await executor.execute(sql`
    with recursive current_principal_states as (
      select distinct on (principal_type, principal_id)
        principal_type,
        principal_id,
        state_hash
      from ${principalStates}
      order by principal_type asc, principal_id asc, version desc
    ),
    removed_users as (
      select member_principal_id as user_id
      from ${principalMembershipProjection}
      where member_principal_type = ${"user"}
        and ${principalMembershipProjection.principalType} = ${previousState.principalType}
        and ${principalMembershipProjection.principalId} = ${previousState.principalId}
        and ${principalMembershipProjection.stateHash} = ${previousState.stateHash}
      except
      select member_principal_id as user_id
      from ${principalMembershipProjection}
      where member_principal_type = ${"user"}
        and ${principalMembershipProjection.principalType} = ${currentState.principalType}
        and ${principalMembershipProjection.principalId} = ${currentState.principalId}
        and ${principalMembershipProjection.stateHash} = ${currentState.stateHash}
    ),
    candidate_containers as (
      select distinct
        c.id::text as container_id,
        c.organization_id::text as organization_id,
        c.parent_id::text as parent_id,
        c.depth::int as depth
      from ${accessManifestContainerGrantProjection} grant_projection
      inner join ${accessManifestHeads} head
        on head.object_kind = ${"container"}
        and head.object_id = grant_projection.container_id
        and head.manifest_hash = grant_projection.manifest_hash
      inner join ${containers} c
        on c.id::text = grant_projection.container_id
      where
        grant_projection.subject_type = ${currentState.principalType}
        and grant_projection.subject_id = ${currentState.principalId}
    ),
    user_current_principals as (
      select
        removed_users.user_id,
        current_state.principal_type,
        current_state.principal_id
      from removed_users
      inner join ${principalMembershipProjection} direct_members
        on direct_members.member_principal_type = ${"user"}
        and direct_members.member_principal_id = removed_users.user_id
      inner join current_principal_states current_state
        on current_state.principal_type = direct_members.principal_type
        and current_state.principal_id = direct_members.principal_id
        and current_state.state_hash = direct_members.state_hash
    ),
    candidate_paths as (
      select
        candidate.container_id as candidate_container_id,
        c.id as path_container_id,
        c.parent_id
      from candidate_containers candidate
      inner join ${containers} c
        on c.id::text = candidate.container_id
      union all
      select
        path.candidate_container_id,
        parent.id as path_container_id,
        parent.parent_id
      from candidate_paths path
      inner join ${containers} parent
        on parent.id = path.parent_id
    ),
    current_access_pairs as (
      select distinct
        removed_users.user_id,
        path.candidate_container_id
      from removed_users
      inner join candidate_paths path on true
      inner join ${accessManifestHeads} head
        on head.object_kind = ${"container"}
        and head.object_id = path.path_container_id::text
      inner join ${accessManifestContainerGrantProjection} grant_projection
        on grant_projection.manifest_hash = head.manifest_hash
      left join user_current_principals reachable
        on reachable.user_id = removed_users.user_id
        and reachable.principal_type = grant_projection.subject_type
        and reachable.principal_id = grant_projection.subject_id
      where
        (
          grant_projection.subject_type = ${"user"}
          and grant_projection.subject_id = removed_users.user_id
        )
        or reachable.principal_id is not null
    )
    select
      removed_users.user_id as "userId",
      candidate.container_id as "containerId",
      candidate.organization_id as "organizationId",
      null::text as "parentId",
      candidate.depth as "depth"
    from removed_users
    cross join candidate_containers candidate
    where not exists (
      select 1
      from current_access_pairs access_pair
      where
        access_pair.user_id = removed_users.user_id
        and access_pair.candidate_container_id = candidate.container_id
    )
    order by removed_users.user_id asc, candidate.container_id asc
  `);

  const rows: PrincipalPolicyAccessLossRow[] = [];
  for (const row of result.rows) {
    if (!isPrincipalPolicyAccessLossRow(row)) {
      throw new Error("Unexpected row shape from principal access-loss query");
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return;
  }

  const rowUpdates = {
    reason: "access_revoked" as const,
    updatedAt,
  };
  await executor
    .insert(containerSyncTombstones)
    .values(
      rows.map((row) => ({
        ...rowUpdates,
        containerId: row.containerId,
        depth: row.depth,
        organizationId: row.organizationId,
        parentId: row.parentId,
        userId: row.userId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        containerSyncTombstones.userId,
        containerSyncTombstones.containerId,
      ],
      set: rowUpdates,
    });
}
