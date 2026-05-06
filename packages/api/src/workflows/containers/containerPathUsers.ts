import type {
  ContainerDirectGrant,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../../adapters/postgres";
import { principalMembershipProjection, principalStates } from "../../schema";

function referencedPrincipalHeadForGrant(input: {
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}) {
  const { grant, manifest } = input;
  if (grant.subjectType === "user") {
    return null;
  }

  return (
    manifest.state.referencedPrincipalHeads.find(
      (principalHead) =>
        principalHead.principalType === grant.subjectType &&
        principalHead.principalId === grant.subjectId,
    ) ?? null
  );
}

function isManagedGrantUserRow(
  value: unknown,
): value is { readonly userId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "userId") === "string"
  );
}

async function userIdsForManagedGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  const referencedPrincipalHead = referencedPrincipalHeadForGrant({
    grant: input.grant,
    manifest: input.manifest,
  });
  if (!referencedPrincipalHead) {
    return [];
  }

  const result = await input.executor.execute(sql`
    with recursive current_principal_states as (
      select distinct on (principal_type, principal_id)
        principal_type,
        principal_id,
        state_hash
      from ${principalStates}
      order by principal_type asc, principal_id asc, version desc
    ),
    reachable_members as (
      select
        ${principalMembershipProjection.memberPrincipalType} as member_principal_type,
        ${principalMembershipProjection.memberPrincipalId} as member_principal_id
      from ${principalMembershipProjection}
      where
        ${principalMembershipProjection.principalType} = ${referencedPrincipalHead.principalType}
        and ${principalMembershipProjection.principalId} = ${referencedPrincipalHead.principalId}
        and ${principalMembershipProjection.stateHash} = ${referencedPrincipalHead.stateHash}
      union
      select
        nested_members.member_principal_type,
        nested_members.member_principal_id
      from reachable_members reachable
      inner join current_principal_states nested_state
        on nested_state.principal_type = reachable.member_principal_type
        and nested_state.principal_id = reachable.member_principal_id
      inner join ${principalMembershipProjection} nested_members
        on nested_members.principal_type = nested_state.principal_type
        and nested_members.principal_id = nested_state.principal_id
        and nested_members.state_hash = nested_state.state_hash
      where reachable.member_principal_type <> ${"user"}
    )
    select distinct member_principal_id as "userId"
    from reachable_members
    where member_principal_type = ${"user"}
  `);
  const userIds: string[] = [];

  for (const row of result.rows) {
    if (!isManagedGrantUserRow(row)) {
      throw new Error("Unexpected row shape from managed grant user query");
    }

    userIds.push(row.userId);
  }

  return userIds;
}

export async function userIdsForGrant(input: {
  readonly executor: DatabaseTransaction;
  readonly grant: ContainerDirectGrant;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<string[]> {
  if (input.grant.subjectType === "user") {
    return [input.grant.subjectId];
  }

  return userIdsForManagedGrant(input);
}

export async function userIdsWithReadableAccessThroughPath(input: {
  readonly executor: DatabaseTransaction;
  readonly path: readonly VerifiedContainerAccessManifest[];
}): Promise<string[]> {
  const userIds = new Set<string>();

  for (const manifest of input.path) {
    for (const grant of manifest.state.directGrants) {
      for (const userId of await userIdsForGrant({
        executor: input.executor,
        grant,
        manifest,
      })) {
        userIds.add(userId);
      }
    }
  }

  return Array.from(userIds);
}
