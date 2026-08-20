import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { ContainerMutationError } from "../errors";

function grantSubjectIds(
  manifest: VerifiedContainerAccessManifest,
  subjectType: "group" | "user",
): string[] {
  return [
    ...new Set(
      manifest.state.directGrants.flatMap((grant) =>
        grant.subjectType === subjectType ? [grant.subjectId] : [],
      ),
    ),
  ];
}

async function assertGroupReferencesValid(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const groupIds = grantSubjectIds(input.manifest, "group");
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

async function assertUserReferencesValid(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  const userIds = grantSubjectIds(input.manifest, "user");
  if (userIds.length === 0) {
    return;
  }
  const activeMembers = await input.executor
    .select({ userId: organizationRosterEntries.userId })
    .from(organizationRosterEntries)
    .where(
      and(
        eq(
          organizationRosterEntries.organizationId,
          input.manifest.state.organizationId,
        ),
        eq(organizationRosterEntries.status, "active"),
        inArray(organizationRosterEntries.userId, userIds),
      ),
    );
  if (activeMembers.length !== userIds.length) {
    throw new ContainerMutationError(
      "Container user grants require active organization members",
      409,
    );
  }
}

export async function assertVerifiedContainerGrantReferencesValid(input: {
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<void> {
  await assertGroupReferencesValid(input);
  await assertUserReferencesValid(input);
}
