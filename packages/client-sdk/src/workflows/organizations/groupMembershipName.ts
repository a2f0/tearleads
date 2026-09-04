import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  canonicalGroupNameKey,
  hasForbiddenGroupNameCharacter,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";

export class GroupMembershipNameMismatchError extends KeyingVerificationError {
  constructor() {
    super(
      "object_mismatch",
      "Group membership name does not match the signed group policy",
    );
    this.name = "GroupMembershipNameMismatchError";
  }
}

/** Check the selected label only after verifying the signed policy bundle. */
export function assertGroupMembershipName(
  verifiedBundle: PrincipalPolicyBundleResponse,
  expectedGroupName: string,
): void {
  if (
    hasForbiddenGroupNameCharacter(expectedGroupName) ||
    canonicalGroupNameKey(readGroupPolicyPayloadName(verifiedBundle)) !==
      canonicalGroupNameKey(expectedGroupName)
  ) {
    throw new GroupMembershipNameMismatchError();
  }
}
