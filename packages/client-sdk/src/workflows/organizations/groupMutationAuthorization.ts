import type { PrincipalPolicyBundleResponse } from "@symcrypt/validators/response";

export function isDirectGroupAdmin(
  policy: PrincipalPolicyBundleResponse,
  userId: string,
): boolean {
  return policy.currentProjection.some(
    (member) => member.userId === userId && member.role === "admin",
  );
}

export function requireSignerCanManageGroup(
  policy: PrincipalPolicyBundleResponse,
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
