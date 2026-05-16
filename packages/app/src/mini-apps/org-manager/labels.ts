export const ORG_MANAGER_LABELS = {
  add: "Add",
  addUser: "Add user",
  authenticate: "Authenticate to manage an organization.",
  access: "Access",
  container: "Container",
  create: "Create",
  directory: "Directory",
  directoryUnavailable: "Directory unavailable.",
  directContainerLinks: "Direct container links",
  failedLoadDirectoryGroups: "Failed to load organization directory or groups.",
  failedLoadGroupContainers: "Failed to load group container links.",
  failedLoadGroupMembers: "Failed to load group members.",
  groupName: "Group name",
  groups: "Groups",
  joined: "Joined",
  loadingDirectory: "Loading directory...",
  members: "Members",
  noDirectUsers: "No direct users.",
  noDirectContainerLinks: "No direct container links.",
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
  updated: "Updated",
  user: "User",
  userId: "User ID",
  userNotFound: "User not found.",
} as const;

export function getOrgManagerEpochLabel(keyEpoch: number): string {
  return `Epoch ${keyEpoch}`;
}

export function getOrgManagerMemberCountLabel(memberCount: number): string {
  return `${memberCount} member${memberCount === 1 ? "" : "s"}`;
}
