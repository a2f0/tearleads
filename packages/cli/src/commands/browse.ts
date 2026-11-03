import type { OrganizationMembership } from "@tearleads/client-sdk";
import type { CommandInput } from "../cliContext";
import { formatFolderTree, loadFolderTree } from "../folderTree";
import { printable } from "../printable";
import { withSavedSession } from "./account";

function membershipFlags(membership: OrganizationMembership): string {
  const flags = [
    membership.isPersonalOrganizationOwner ? "personal" : null,
    membership.syncPaused ? "sync paused" : null,
    membership.leaveRequestedAt ? "leave requested" : null,
  ].filter((flag) => flag !== null);
  return flags.length > 0 ? `  (${flags.join(", ")})` : "";
}

export async function listOrganizations(input: CommandInput): Promise<void> {
  const lines = await withSavedSession(input, async (session) => {
    // Names come from organization profiles, which arrive with the folders.
    const { memberships } = await loadFolderTree(session);
    const local = await session.sdk.organizations.listLocalOrganizations();
    const names = new Map(
      local.map((organization) => [
        organization.organizationId,
        organization.name,
      ]),
    );
    return memberships.map((membership) =>
      printable(
        `${membership.organizationId}  ${names.get(membership.organizationId) ?? "(name not synced)"}${membershipFlags(membership)}`,
      ),
    );
  });
  for (const line of lines) input.context.stdout(line);
}

export async function listFolders(input: CommandInput): Promise<void> {
  const lines = await withSavedSession(input, async (session) => {
    const organizationId = session.sdk.session.organizationId;
    if (!organizationId) {
      throw new Error("The session has no organization.");
    }
    const { nodes } = await loadFolderTree(session);
    return formatFolderTree(nodes, organizationId);
  });
  for (const line of lines) input.context.stdout(line);
}
