import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
  OrganizationUserRecipient,
} from "@tearleads/client-sdk";

// Demo-only roster seeding. The demo panes each register their own personal
// organization; this module decides whether the pane still owes an "add the peer
// to my org roster" write. The server derives roster/directory entries from
// member-group reachability (there is no direct add-roster-entry API), so the
// only way to surface the peer on this pane's roster is to add them to the
// organization's builtin member group — exactly what the org-manager "Import
// user" action does, minus any custom-group membership.
//
// Kept data-only so the decision logic is pure and unit-testable apart from the
// React effect that loads directory state and issues the group-policy write.

// Preconditions the pane must satisfy before it can attempt to seed the peer
// onto its roster. Mirrors the org-manager `canImportRosterUser` gate: an
// authenticated session with a resolved organization and user id plus the
// signing/encapsulation material the member-group policy write requires.
interface DemoPeerRosterSeedGate {
  readonly canWrite: boolean;
  readonly isAuthenticated: boolean;
  readonly peerUserId: string | null;
}

export function shouldAttemptRosterSeed(gate: DemoPeerRosterSeedGate): boolean {
  return (
    gate.canWrite &&
    gate.isAuthenticated &&
    (gate.peerUserId ?? "").trim().length > 0
  );
}

function directoryUserRecipient(
  user: OrganizationDirectoryUser,
): OrganizationUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function memberRecipient(
  member: OrganizationGroupMember,
): OrganizationUserRecipient | null {
  if (
    member.memberPrincipalType !== "user" ||
    !member.encapsulationPublicKey ||
    !member.encapsulationKeyFingerprint
  ) {
    return null;
  }

  return {
    userId: member.memberPrincipalId,
    encapsulationPublicKey: member.encapsulationPublicKey,
    encapsulationKeyFingerprint: member.encapsulationKeyFingerprint,
  };
}

// The recipients whose keys the member-group policy must be re-encrypted for:
// every current directory user plus any member-group member not yet in the
// directory. Deduped by user id (directory entries win, matching the
// org-manager recipient projection).
export function memberGroupRecipients(input: {
  readonly directory: OrganizationDirectory;
  readonly members: OrganizationGroupMembers | null;
}): OrganizationUserRecipient[] {
  const recipientsById = new Map<string, OrganizationUserRecipient>();

  for (const member of input.members?.members ?? []) {
    const recipient = memberRecipient(member);
    if (recipient) {
      recipientsById.set(recipient.userId, recipient);
    }
  }
  for (const user of input.directory.users) {
    const recipient = directoryUserRecipient(user);
    recipientsById.set(recipient.userId, recipient);
  }

  return [...recipientsById.values()];
}

// Whether the peer already appears on this pane's roster as an active user. Once
// the member-group add lands and the server syncs roster entries from member
// reachability, this returns true and the seeder re-plans to nothing.
export function isPeerOnRoster(
  directory: OrganizationDirectory,
  peerUserId: string,
): boolean {
  return directory.users.some(
    (user) => user.userId === peerUserId && user.status === "active",
  );
}

// Whether the peer is already a user member of the (member) group. Guards
// against a redundant add when the roster projection has not caught up yet.
export function isPeerInMemberGroup(
  members: OrganizationGroupMembers | null,
  peerUserId: string,
): boolean {
  return Boolean(
    members?.members.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === peerUserId,
    ),
  );
}

type DemoPeerRosterSeedPlan =
  | { readonly kind: "idle" }
  | {
      readonly kind: "add-to-member-group";
      readonly canAdministerOrganization: boolean;
      readonly currentUsers: OrganizationUserRecipient[];
      // The peer's recipient when it is already in the directory; null means the
      // executor must import it by id (fetching the peer's encapsulation key)
      // before adding.
      readonly existingRecipient: OrganizationUserRecipient | null;
      readonly memberGroupId: string;
      readonly peerUserId: string;
    };

/**
 * Decides whether this pane still owes a member-group add to surface the peer on
 * its roster. Pure and idempotent: returns `idle` when the directory/member
 * group is unavailable, or once the peer is already an active roster user or a
 * member-group member. Otherwise returns the add descriptor with the recipients
 * the policy re-encryption needs.
 */
export function planDemoPeerRosterSeed(input: {
  readonly directory: OrganizationDirectory | null;
  readonly memberGroupId: string | null;
  readonly members: OrganizationGroupMembers | null;
  readonly peerUserId: string;
}): DemoPeerRosterSeedPlan {
  const { directory, memberGroupId, members, peerUserId } = input;
  if (!directory || !memberGroupId) {
    return { kind: "idle" };
  }
  if (
    isPeerOnRoster(directory, peerUserId) ||
    isPeerInMemberGroup(members, peerUserId)
  ) {
    return { kind: "idle" };
  }

  const existing =
    directory.users.find((user) => user.userId === peerUserId) ?? null;

  return {
    kind: "add-to-member-group",
    canAdministerOrganization: directory.currentUser.isOrgAdmin,
    currentUsers: memberGroupRecipients({ directory, members }),
    existingRecipient: existing ? directoryUserRecipient(existing) : null,
    memberGroupId,
    peerUserId,
  };
}
