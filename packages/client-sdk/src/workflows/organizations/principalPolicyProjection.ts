import type { PrincipalProjectionMemberRequest } from "@tearleads/validators/request";

export function ensureNoNestedGroupMembers(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): void {
  if (projection.some((member) => member.memberPrincipalType === "group")) {
    throw new Error(
      "Nested group membership is not supported in this version of organization administration",
    );
  }
}

export function hasAdmin(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): boolean {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" && member.role === "admin",
  );
}
