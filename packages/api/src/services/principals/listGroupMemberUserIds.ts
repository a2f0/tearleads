import { listUsersReachableFromCurrentGroup } from "../../workflows/organizations/principalReachability";
import type { ApiServiceRuntime } from "../runtime";

/** The current direct members of a group: the users a group grant makes readers. */
export function listGroupMemberUserIds(
  runtime: ApiServiceRuntime,
  groupId: string,
): Promise<string[]> {
  return listUsersReachableFromCurrentGroup({ executor: runtime.db, groupId });
}
