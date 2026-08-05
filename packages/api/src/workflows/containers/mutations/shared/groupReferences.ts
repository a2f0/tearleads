import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { inArray } from "drizzle-orm";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { ContainerMutationError } from "../errors";

export async function assertVerifiedContainerGroupReferencesExist(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const groupIds = input.manifest.state.directGrants.flatMap((grant) =>
    grant.subjectType === "group" ? [grant.subjectId] : [],
  );
  const missingGroupIds = await lockAndFindMissingGroupReferencesInTransaction(
    input.executor,
    groupIds,
  );
  if (missingGroupIds.length > 0) {
    throw new ContainerMutationError(
      "Container manifest references a missing group",
      409,
    );
  }
  if (groupIds.length === 0) {
    return;
  }
  const groupOrganizations = await input.executor
    .select({ organizationId: groups.organizationId })
    .from(groups)
    .where(inArray(groups.id, groupIds));
  if (
    groupOrganizations.some(
      (group) => group.organizationId !== input.manifest.state.organizationId,
    )
  ) {
    throw new ContainerMutationError(
      "Container group grants must stay within the organization",
      409,
    );
  }
}
