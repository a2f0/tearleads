import type { PrincipalProjectionMemberRequest } from "@tearleads/validators/request";

export function hasAdmin(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): boolean {
  return projection.some((member) => member.role === "admin");
}
