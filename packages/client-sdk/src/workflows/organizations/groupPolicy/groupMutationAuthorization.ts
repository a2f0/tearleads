import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export function isDirectGroupAdmin(
  policy: Pick<PrincipalPolicyBundleResponse, "currentProjection">,
  userId: string,
): boolean {
  return policy.currentProjection.some(
    (member) => member.userId === userId && member.role === "admin",
  );
}

export function requireSignerCanManageGroup(
  policy: Pick<PrincipalPolicyBundleResponse, "currentProjection">,
  organizationAdminUserIds: readonly string[],
  signerUserId: string,
): void {
  if (
    !organizationAdminUserIds.includes(signerUserId) &&
    !isDirectGroupAdmin(policy, signerUserId)
  ) {
    throw new Error("Group admin membership is required");
  }
}
