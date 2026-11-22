export const SHARED_WITH_ME_LABELS = {
  actionsColumn: "Actions",
  actionsFor: (name: string) => `Actions for ${name}`,
  askToLeave: (organizationName: string) => `Ask to leave ${organizationName}`,
  empty: "Nothing shared with you yet",
  emptyDescription:
    "Folders shared with you appear here once this device has synced them, with the organization that shared them.",
  leaveRequestFailed: "Your request to leave could not be changed.",
  leaveRequestedStatus: "Leave requested",
  leaveRequestedStatusDetail:
    "You asked to leave. An administrator of this organization can approve it.",
  loading: "Loading what is shared with you",
  nameColumn: "Name",
  nothingSharedStatus: "Nothing shared yet",
  nothingSharedStatusDetail:
    "Nothing in this organization is shared with you yet.",
  open: "Open",
  organizationColumn: "Organization",
  pauseSync: (organizationName: string) => `Pause sync for ${organizationName}`,
  permissionAdmin: "Admin",
  permissionColumn: "Permission",
  permissionNone: "-",
  permissionRead: "Read",
  permissionWrite: "Write",
  resumeSync: (organizationName: string) =>
    `Resume sync for ${organizationName}`,
  statusColumn: "Status",
  syncChangeFailed: "Sync could not be changed for this organization.",
  syncPausedStatus: "Sync paused",
  syncPausedStatusDetail:
    "Sync is paused. Nothing uploads or downloads for this organization, and changes you make stay on this device until you resume.",
  title: "Shared with Me",
  unnamedOrganization: "Untitled organization",
  updatingStatus: "Updating...",
  withdrawLeaveRequest: (organizationName: string) =>
    `Withdraw request to leave ${organizationName}`,
  workspaceRoot: "All files",
} as const;
