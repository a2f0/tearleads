import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { PrincipalProjectionMemberRequest } from "@tearleads/validators/request";
import { lockAndFindMissingGroupReferencesInTransaction } from "./groupReferenceLock";
import { PrincipalPolicyError } from "./shared";

export async function assertPrincipalPolicyGroupReferencesExist(input: {
  readonly projection: readonly PrincipalProjectionMemberRequest[];
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  const missingGroupIds = await lockAndFindMissingGroupReferencesInTransaction(
    input.tx,
    input.projection.flatMap((member) =>
      member.userId === "group" ? [member.userId] : [],
    ),
  );
  if (missingGroupIds.length > 0) {
    throw new PrincipalPolicyError(
      "Principal policy references a missing group",
      409,
    );
  }
}
