import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  listContainerGrantsForState,
} from "../../../../access/read/principalStateStore";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { ContainerMutationError } from "../errors";
import type { ContainerMutationContext } from "../types";
import { assertGroupReferenceHeadsCurrent } from "./groupReferenceHeads";

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
  if (groupIds.length === 0) {
    return;
  }
  const deletedGroups = await input.executor
    .select({ groupId: organizationGroupTombstones.groupId })
    .from(organizationGroupTombstones)
    .where(inArray(organizationGroupTombstones.groupId, groupIds));
  if (deletedGroups.length > 0) {
    throw new ContainerMutationError(
      "Container manifest references a deleted group",
      409,
    );
  }
  if (missingGroupIds.length > 0) {
    throw new ContainerMutationError(
      "Container manifest references a missing group",
      409,
    );
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
  await assertGroupReferenceHeadsCurrent(
    input.executor,
    input.manifest.state.referencedPrincipalHeads,
  );
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

export async function assertGroupGrantSetChangesAreAtomic(
  context: ContainerMutationContext,
  artifacts: {
    readonly manifest: VerifiedContainerAccessManifest;
    readonly previousManifest: VerifiedContainerAccessManifest | null;
  },
): Promise<void> {
  const previousByGroupId = new Map(
    (artifacts.previousManifest?.state.directGrants ?? [])
      .filter((grant) => grant.subjectType === "group")
      .map((grant) => [grant.subjectId, grant] as const),
  );
  const currentByGroupId = new Map(
    artifacts.manifest.state.directGrants
      .filter((grant) => grant.subjectType === "group")
      .map((grant) => [grant.subjectId, grant] as const),
  );
  const changedGroupIds = [
    ...new Set([...previousByGroupId.keys(), ...currentByGroupId.keys()]),
  ].filter((groupId) => {
    const previous = previousByGroupId.get(groupId);
    const current = currentByGroupId.get(groupId);
    return previous?.accessLevel !== current?.accessLevel;
  });
  for (const groupId of changedGroupIds) {
    if (groupId === context.mutatingGroupPrincipalId) {
      continue;
    }
    const currentGrant = currentByGroupId.get(groupId);
    if (!currentGrant) {
      throw new ContainerMutationError(
        "Group grants must be revoked atomically with principal rotation",
        409,
      );
    }
    const principalState = await getCurrentPrincipalState(
      "group",
      groupId,
      context.executor,
    );
    const signedGrants = principalState
      ? await listContainerGrantsForState(
          "group",
          groupId,
          principalState.stateHash,
          context.executor,
        )
      : [];
    if (
      !signedGrants.some(
        (grant) =>
          grant.containerId === artifacts.manifest.state.containerId &&
          grant.accessLevel === currentGrant.accessLevel,
      )
    ) {
      throw new ContainerMutationError(
        "Group grant changes require a matching signed principal grant index",
        409,
      );
    }
  }
}
