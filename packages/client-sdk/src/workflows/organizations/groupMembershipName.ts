import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  type GroupPolicyNameReader,
  groupPolicyNameMismatch,
} from "./principalPolicyRequest";

export class GroupMembershipNameMismatchError extends KeyingVerificationError {
  constructor(reason: "forbidden_characters" | "name_mismatch") {
    super(
      "object_mismatch",
      reason === "forbidden_characters"
        ? "Group membership name contains forbidden control or format characters"
        : "Group membership name does not match the signed group policy",
    );
    this.name = "GroupMembershipNameMismatchError";
  }
}

/** Check the selected label only after verifying the signed policy bundle. */
export async function assertGroupMembershipName(
  verifiedBundle: PrincipalPolicyBundleResponse,
  expectedGroupName: string,
  readEncryptedName?: GroupPolicyNameReader,
): Promise<void> {
  const mismatch = await groupPolicyNameMismatch(
    verifiedBundle,
    expectedGroupName,
    readEncryptedName,
  );
  if (mismatch) {
    throw new GroupMembershipNameMismatchError(mismatch);
  }
}
