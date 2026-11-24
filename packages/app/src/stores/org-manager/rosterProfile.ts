import {
  type ContainerContentsStore,
  type ContainerNode,
  type OrganizationDirectoryUser,
  type Tearleads,
  UnverifiedUserIdentityError,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { captureDocumentsAuthority } from "../documents/documentsAuthority";
import {
  createRosterProfileDocument,
  type RosterProfileNames,
} from "./profileDocuments";

// React-free roster profile writes, shared by the org-manager provider and the
// CLI's `seed --roster`. Each caller supplies its own notion of "still the
// same operation": the provider's committed scope generation, or the CLI
// writer scope.

interface OrganizationSystemContainerInput {
  readonly independentRoot: boolean;
  readonly organizationId: string;
  readonly systemSlot: ContainerSystemSlot;
}

/** The organization's system container in `systemSlot` this device holds. */
export function findOrganizationSystemContainer(
  input: OrganizationSystemContainerInput & {
    readonly containerStore: Pick<ContainerContentsStore, "getSnapshot">;
  },
): ContainerNode | null {
  return (
    input.containerStore
      .getSnapshot()
      .nodes.find(
        (node) =>
          node.systemSlot === input.systemSlot &&
          node.organizationId === input.organizationId &&
          (input.independentRoot
            ? node.parentId === null
            : node.parentId !== null),
      ) ?? null
  );
}

/** The organization's system container in `systemSlot`, created when absent. */
export async function ensureOrganizationSystemContainer(
  input: OrganizationSystemContainerInput & {
    readonly containerStore: Pick<
      ContainerContentsStore,
      "ensureSystemContainer" | "getSnapshot"
    >;
    readonly name: string;
  },
): Promise<ContainerNode | null> {
  return (
    findOrganizationSystemContainer(input) ??
    (await input.containerStore.ensureSystemContainer(
      input.systemSlot,
      input.name,
    ))
  );
}

/**
 * Gives `user`'s roster entry a profile document carrying their keys and the
 * optional `names`, and points the entry at it. Returns the updated entry, the
 * entry unchanged when it already has a profile, or `null` when the operation
 * stopped being current. Throws `UnverifiedUserIdentityError` unless a verified
 * identity link (or this device's own keys) established the user's keys.
 */
export async function ensureRosterProfileForUser(input: {
  readonly tearleads: Tearleads;
  readonly user: OrganizationDirectoryUser;
  readonly names?: RosterProfileNames | undefined;
  readonly organizationId: string;
  /** The signed-in user, whose own profile is marked as self. */
  readonly selfUserId: string;
  readonly ensureRosterProfileContainer: () => Promise<ContainerNode | null>;
  readonly scopeActive: () => boolean;
}): Promise<OrganizationDirectoryUser | null> {
  const { tearleads, user, scopeActive } = input;
  if (user.profileDocumentId) {
    return user;
  }
  const container = await input.ensureRosterProfileContainer();
  if (!container?.id || !scopeActive()) {
    return null;
  }

  // A roster profile carries the user's keys, so only an identity a verified
  // link (or this device's own keys) established may seed one.
  const identity = await tearleads.userIdentities.resolveVerified(user.userId);
  if (!scopeActive()) {
    return null;
  }
  if (!identity) {
    throw new UnverifiedUserIdentityError(user.userId);
  }
  // Creation can wait for a remote id; realtime notifications in that window
  // must not drop the pointer, but an authority change does.
  const authorityCurrent = captureDocumentsAuthority(tearleads);
  const stillCurrent = () => authorityCurrent() && scopeActive();
  const profileDocumentId = await createRosterProfileDocument({
    containerId: container.id,
    documents: tearleads.documents,
    identity,
    isSelf: identity.userId === input.selfUserId,
    names: input.names,
    organizationId: input.organizationId,
    stillCurrent,
  });
  if (!profileDocumentId || !stillCurrent()) {
    return null;
  }
  return tearleads.organizations.updateRosterEntry(
    user.userId,
    profileDocumentId,
  );
}
