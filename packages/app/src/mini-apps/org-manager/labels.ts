export const ORG_MANAGER_LABELS = {
  add: "Add",
  addUser: "Add user",
  authenticate: "Authenticate to manage an organization.",
  create: "Create",
  directory: "Directory",
  directoryUnavailable: "Directory unavailable.",
  failedLoadDirectoryGroups: "Failed to load organization directory or groups.",
  failedLoadGroupMembers: "Failed to load group members.",
  groupName: "Group name",
  groups: "Groups",
  joined: "Joined",
  loadingDirectory: "Loading directory...",
  noDirectUsers: "No direct users.",
  noGroupMembers: "No group members.",
  noGroups: "No groups.",
  noPolicy: "No policy",
  refresh: "Refresh",
  remove: "Remove",
  role: "Role",
  selectGroup: "Select a group.",
  self: "You",
  signingKey: "Signing key",
  uninitialized: "Uninitialized",
  user: "User",
} as const;

export function getOrgManagerEpochLabel(keyEpoch: number): string {
  return `Epoch ${keyEpoch}`;
}

export function getOrgManagerMemberCountLabel(memberCount: number): string {
  return `${memberCount} member${memberCount === 1 ? "" : "s"}`;
}
