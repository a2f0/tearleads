export const ORGANIZATIONS_LABELS = {
  activeBadge: "Active",
  empty: "You don't belong to any organizations on this device yet.",
  foldersIn: (organizationName: string) => `Folders in ${organizationName}`,
  loading: "Loading organizations...",
  memberBadge: "Member",
  noFolders: "Nothing in this organization is shared with you yet.",
  pauseBlockedByUnsyncedWrites:
    "This organization has changes that have not uploaded yet. Try again once they finish syncing.",
  pauseSync: "Pause sync",
  pausingSync: "Pausing...",
  resumeSync: "Resume sync",
  resumingSync: "Resuming...",
  syncChangeFailed: "Sync could not be changed for this organization.",
  syncPausedBadge: "Sync paused",
  syncPausedStatus:
    "Sync is paused on your devices, so this organization's folders are not kept here.",
  readOnlyBadge: "Read only",
  title: "Organizations",
  unnamedOrganization: "Untitled organization",
  workspaceBadge: "Workspace",
  workspaceRoot: "All files",
} as const;
