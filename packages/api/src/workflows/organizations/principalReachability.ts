import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import { currentPrincipalStateHashSql } from "../principals/currentPrincipalStateSql";

function readReachableGroupId(row: unknown): string {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected principal reachability row shape");
  }

  const groupId = Reflect.get(row, "groupId");
  if (typeof groupId !== "string") {
    throw new Error("Unexpected principal reachability row shape");
  }

  return groupId;
}

function readReachableUserId(row: unknown): string {
  if (!row || typeof row !== "object") {
    throw new Error("Unexpected principal reachability row shape");
  }

  const userId = Reflect.get(row, "userId");
  if (typeof userId !== "string") {
    throw new Error("Unexpected principal reachability row shape");
  }

  return userId;
}

export async function listUserReachableCurrentGroupIds(input: {
  executor: DatabaseSession;
  groupIds: readonly string[];
  userId: string;
}): Promise<Set<string>> {
  const groupIds = [...new Set(input.groupIds)].sort();
  if (groupIds.length === 0) {
    return new Set();
  }

  const result = await input.executor.execute(sql`
    with recursive
      reachable_principals(
        principal_type,
        principal_id
      ) as (
        select
          pmp.principal_type,
          pmp.principal_id
        from ${principalMembershipProjection} pmp
        where
          pmp.principal_type = ${"group"}
          and pmp.member_principal_type = ${"user"}
          and pmp.member_principal_id = ${input.userId}
          and pmp.state_hash = ${currentPrincipalStateHashSql({
            principalId: sql`pmp.principal_id`,
            principalType: sql`pmp.principal_type`,
          })}
        union
        select
          pmp.principal_type,
          pmp.principal_id
        from reachable_principals rp
        inner join ${principalMembershipProjection} pmp
          on pmp.member_principal_type = rp.principal_type
          and pmp.member_principal_id = rp.principal_id
        where
          rp.principal_type = ${"group"}
          and pmp.principal_type = ${"group"}
          and pmp.state_hash = ${currentPrincipalStateHashSql({
            principalId: sql`pmp.principal_id`,
            principalType: sql`pmp.principal_type`,
          })}
      )
    select distinct principal_id as "groupId"
    from reachable_principals
    where
      principal_type = ${"group"}
      and principal_id in (${sql.join(
        groupIds.map((groupId) => sql`${groupId}`),
        sql`, `,
      )})
  `);

  return new Set(result.rows.map(readReachableGroupId));
}

export async function listUsersReachableFromCurrentGroup(input: {
  executor: DatabaseSession;
  groupId: string;
}): Promise<string[]> {
  return listUsersReachableFromCurrentPrincipal({
    executor: input.executor,
    principalId: input.groupId,
    principalType: "group",
  });
}

export async function listUsersReachableFromCurrentPrincipal(input: {
  executor: DatabaseSession;
  principalId: string;
  principalType: "group" | "organization";
}): Promise<string[]> {
  const result = await input.executor.execute(sql`
    with recursive
      reachable_members(
        member_principal_type,
        member_principal_id
      ) as (
        select
          pmp.member_principal_type,
          pmp.member_principal_id
        from ${principalMembershipProjection} pmp
        where
          pmp.principal_type = ${input.principalType}
          and pmp.principal_id = ${input.principalId}
          and pmp.state_hash = ${currentPrincipalStateHashSql({
            principalId: sql`pmp.principal_id`,
            principalType: sql`pmp.principal_type`,
          })}
        union
        select
          pmp.member_principal_type,
          pmp.member_principal_id
        from reachable_members reachable
        inner join ${principalMembershipProjection} pmp
          on pmp.principal_type = ${"group"}
          and pmp.principal_id = reachable.member_principal_id
        where
          reachable.member_principal_type = ${"group"}
          and pmp.state_hash = ${currentPrincipalStateHashSql({
            principalId: sql`pmp.principal_id`,
            principalType: sql`pmp.principal_type`,
          })}
      )
    select distinct member_principal_id as "userId"
    from reachable_members
    where member_principal_type = ${"user"}
  `);

  return result.rows.map(readReachableUserId).sort();
}
