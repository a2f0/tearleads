import {
  deriveOrganizationRosterProfileContainerSystemSlot,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
  type Tearleads,
} from "@tearleads/client-sdk";
import {
  ensureOrganizationSystemContainer,
  ensureRosterProfileForUser,
} from "../../stores/org-manager/rosterProfile";
import type { GroupSeedActions } from "../../stores/org-manager/rosterSeed";
import { openReadyContainerTree } from "./contactsContainer";
import { captureContinuityScope } from "./continuityScope";
import type { SeedSpec } from "./seedTypes";

export {
  createGroupMembersSeed,
  seedRosterEntry,
} from "../../stores/org-manager/rosterSeed";

export interface ContinuityGroupMember {
  /** Continuity's character ID, stable across dataset versions. */
  readonly contactId: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface ContinuityGroup {
  readonly name: string;
  readonly members: readonly ContinuityGroupMember[];
}

/** The dataset's groups with each member's contact names resolved. */
export function continuityGroups(spec: SeedSpec): ContinuityGroup[] {
  const contacts = new Map(
    (spec.contacts ?? []).map((contact) => [contact.id, contact]),
  );
  return (spec.groups ?? []).map((group) => ({
    name: group.name,
    members: group.members.map((contactId) => {
      const fields = contacts.get(contactId)?.fields;
      if (!fields?.firstName || !fields.lastName) {
        throw new Error(`Group member ${contactId} has no contact name.`);
      }
      return {
        contactId,
        firstName: fields.firstName,
        lastName: fields.lastName,
      };
    }),
  }));
}

/**
 * The roster and group actions the org-manager provider gives the app, built
 * for a headless host from the signed-in SDK, so the CLI seeds a roster
 * through the same writes the Org Manager makes.
 */
export async function continuityRosterActions(
  sdk: Tearleads,
): Promise<GroupSeedActions> {
  const scope = captureContinuityScope(sdk);
  const { organizationId, userId } = sdk.session;
  if (!organizationId || !userId) {
    throw new Error("Roster seeding requires a signed-in organization.");
  }
  const tree = await openReadyContainerTree(sdk, scope);
  const ensureRosterProfileContainer = async () => {
    const systemSlot = await deriveOrganizationRosterProfileContainerSystemSlot(
      { organizationId },
    );
    scope.assertCurrent();
    return ensureOrganizationSystemContainer({
      containerStore: tree,
      independentRoot: false,
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      organizationId,
      systemSlot,
    });
  };
  const { organizations } = sdk;
  return {
    addUserToGroup: (groupId, targetUserId, expectedGroupName) =>
      organizations.addUserToGroup({
        groupId,
        targetUserId,
        expectedGroupName,
      }),
    createGroup: (name) => organizations.createGroup(name),
    ensureRosterProfileDocument: (user, names) =>
      ensureRosterProfileForUser({
        tearleads: sdk,
        user,
        names,
        organizationId,
        selfUserId: userId,
        ensureRosterProfileContainer,
        scopeActive: scope.stillCurrent,
      }),
    loadDirectoryAndGroups: () => organizations.loadDirectoryAndGroups(),
    loadGroupMembers: (groupId) => organizations.loadGroupMembers(groupId),
  };
}
