import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { ContainerMutationError } from "../errors";

export async function assertVerifiedContainerGroupReferencesExist(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const missingGroupIds = await lockAndFindMissingGroupReferencesInTransaction(
    input.executor,
    input.manifest.state.directGrants.flatMap((grant) =>
      grant.subjectType === "group" ? [grant.subjectId] : [],
    ),
  );
  if (missingGroupIds.length > 0) {
    throw new ContainerMutationError(
      "Container manifest references a missing group",
      409,
    );
  }
}
