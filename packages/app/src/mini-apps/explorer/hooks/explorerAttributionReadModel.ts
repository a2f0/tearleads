import type { OrganizationDirectoryAndGroups } from "@symcrypt/client-sdk";
import {
  getLocalRosterProfileDisplayNames,
  getRosterProfileBindingsByLocalId,
  getRosterProfileDocumentBindingKey,
  type RosterProfileBinding,
} from "../../../stores/org-manager/rosterProfileDisplayNames";

interface ExplorerAttributionOrganizations {
  loadLocalDirectoryAndGroups: () => Promise<OrganizationDirectoryAndGroups | null>;
}

// Attribution labels are presentation over the locally projected roster. The
// demand-scoped catch-up is the only owner of remote reconciliation.
export async function loadExplorerAttributionDirectoryAndGroups(
  organizations: ExplorerAttributionOrganizations,
  reconciledProjection?: OrganizationDirectoryAndGroups | null,
) {
  if (reconciledProjection !== undefined) {
    return reconciledProjection;
  }
  return organizations.loadLocalDirectoryAndGroups();
}

export function getExplorerAttributionProjectionKey(input: {
  readonly projection?: OrganizationDirectoryAndGroups | null | undefined;
  readonly revision: number;
}): string {
  if (input.revision === 0) {
    return "local";
  }
  const directory = input.projection?.directory;
  if (!directory) {
    return "purged";
  }
  const profileDocuments = directory.users
    .map(getRosterProfileDocumentBindingKey)
    .filter((key): key is string => key !== null)
    .sort();
  return JSON.stringify([directory.currentUser.isOrgAdmin, profileDocuments]);
}

export function getExplorerAttributionProfileBindingsByLocalId(input: {
  directoryAndGroups: OrganizationDirectoryAndGroups;
  organizationId: string;
}): ReadonlyMap<string, RosterProfileBinding> {
  const directory = input.directoryAndGroups.directory;
  if (
    !directory.currentUser.isOrgAdmin ||
    directory.organizationId !== input.organizationId
  ) {
    return new Map();
  }
  return getRosterProfileBindingsByLocalId({
    organizationId: input.organizationId,
    users: directory.users,
  });
}

export const getExplorerAttributionProfileDisplayNames =
  getLocalRosterProfileDisplayNames;
