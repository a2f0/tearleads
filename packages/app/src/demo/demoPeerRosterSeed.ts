import type {
  ImportedOrganizationUser,
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupMembers,
} from "@symcrypt/client-sdk";
import { KeyingVerificationError } from "@symcrypt/crypto";

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
// local signing/encapsulation material the member-group policy write requires.
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
    members?.members.some((member) => member.userId === peerUserId),
  );
}

type DemoPeerRosterSeedPlan =
  | { readonly kind: "idle" }
  | {
      readonly kind: "add-to-member-group";
      readonly memberGroupId: string;
      readonly peerUserId: string;
      // Unknown users must be imported before the membership write. Known
      // directory users can go straight to the SDK's trusted identity gateway.
      readonly requiresImport: boolean;
    };

/**
 * Decides whether this pane still owes a member-group add to surface the peer on
 * its roster. Pure and idempotent: returns `idle` when the directory/member
 * group is unavailable, or once the peer is already an active roster user or a
 * member-group member. Otherwise returns the user-id-only add descriptor; the
 * SDK resolves all cryptographic recipient material behind its trust boundary.
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
    memberGroupId,
    peerUserId,
    requiresImport: existing === null,
  };
}

// The org-manager actions the demo roster seeder drives. Declared structurally
// (rather than importing the provider type) so the orchestration below stays
// unit-testable with a fake and free of a store dependency.
export interface DemoRosterSeedActions {
  readonly addUserToGroup: (
    groupId: string,
    targetUserId: string,
  ) => Promise<unknown>;
  readonly ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
    nickname?: string | undefined,
  ) => Promise<OrganizationDirectoryUser | null>;
  readonly importUserById: (
    userId: string,
  ) => Promise<ImportedOrganizationUser | null>;
  readonly loadDirectoryAndGroups: () => Promise<
    OrganizationDirectoryAndGroups | null | undefined
  >;
  readonly loadGroupMembers: (
    groupId: string,
  ) => Promise<OrganizationGroupMembers | null>;
}

export async function attemptPeerRosterSeed(
  actions: DemoRosterSeedActions,
  peerUserId: string,
  peerNickname: string,
  logError: (message: string, error: unknown) => void,
): Promise<boolean> {
  try {
    return await seedPeerRosterEntry(actions, peerUserId, peerNickname);
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    logError("Demo peer bootstrap: failed to seed peer roster entry.", error);
    return false;
  }
}

/**
 * Drives the two roster writes the demo owes for the peer, one phase per call so
 * the caller's bounded retry advances it as server state settles:
 *  1. add the peer to this pane's member group (surfaces them on the roster), and
 *  2. give the peer's roster entry a friendly nickname profile document.
 *
 * Returns whether the seed is settled: `true` once the peer is on the roster and
 * has a profile document, `false` while org/peer state is not ready yet (the add
 * has not synced, the peer key is not queryable, ...) so the caller retries.
 */
export async function seedPeerRosterEntry(
  actions: DemoRosterSeedActions,
  peerUserId: string,
  peerNickname: string,
): Promise<boolean> {
  const directoryAndGroups = await actions.loadDirectoryAndGroups();
  const directory = directoryAndGroups?.directory ?? null;
  const memberGroupId = directoryAndGroups?.memberGroupId ?? null;
  if (!directory || !memberGroupId) {
    return false;
  }

  // Phase 1: ensure the peer is an active roster member.
  if (!isPeerOnRoster(directory, peerUserId)) {
    const members = await actions.loadGroupMembers(memberGroupId);
    if (!members) {
      // Wait until membership state is authoritative enough to determine
      // whether the add is still owed. The SDK resolves policy recipients.
      return false;
    }
    const plan = planDemoPeerRosterSeed({
      directory,
      memberGroupId,
      members,
      peerUserId,
    });
    if (plan.kind === "add-to-member-group") {
      const importedUser = plan.requiresImport
        ? await actions.importUserById(peerUserId)
        : { userId: peerUserId };
      if (!importedUser) {
        return false;
      }
      await actions.addUserToGroup(plan.memberGroupId, importedUser.userId);
    }
    // The membership write (or a prior one) has not surfaced in this directory
    // snapshot yet; retry so the next attempt can seed the profile nickname.
    return false;
  }

  // Phase 2: give the peer's roster entry a nickname profile document.
  const peerUser =
    directory.users.find((user) => user.userId === peerUserId) ?? null;
  if (!peerUser) {
    return false;
  }
  if (peerUser.profileDocumentId) {
    return true;
  }

  const updated = await actions.ensureRosterProfileDocument(
    peerUser,
    peerNickname,
  );
  return Boolean(updated?.profileDocumentId);
}
