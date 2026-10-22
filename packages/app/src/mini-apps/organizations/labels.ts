export const ORGANIZATIONS_LABELS = {
  activeBadge: "Active",
  empty: "You don't belong to any organizations on this device yet.",
  foldersIn: (organizationName: string) => `Folders in ${organizationName}`,
  loading: "Loading organizations...",
  memberBadge: "Member",
  noFolders: "Nothing in this organization is shared with you yet.",
  readOnlyBadge: "Read only",
  title: "Organizations",
  unnamedOrganization: "Untitled organization",
  workspaceBadge: "Workspace",
  workspaceRoot: "All files",
} as const;
