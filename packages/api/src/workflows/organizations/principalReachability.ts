import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import { currentPrincipalStateHashSql } from "../principals/currentPrincipalStateSql";

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
  // The members ARE the reachable users. This used to descend through
  // group-in-group edges; principals contain only users now.
  const result = await input.executor.execute(sql`
    select distinct pmp.user_id as "userId"
    from ${principalMembershipProjection} pmp
    where
      pmp.principal_type = ${input.principalType}
      and pmp.principal_id = ${input.principalId}
      and pmp.state_hash = ${currentPrincipalStateHashSql({
        principalId: sql`pmp.principal_id`,
        principalType: sql`pmp.principal_type`,
      })}
  `);

  return result.rows.map(readReachableUserId).sort();
}
