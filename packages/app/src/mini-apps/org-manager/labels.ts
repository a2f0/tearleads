export const ORG_MANAGER_LABELS = {
  add: "Add",
  addUser: "Add user",
  authenticate: "Authenticate to manage an organization.",
  access: "Access",
  accessAdmin: "Admin",
  accessRead: "Read",
  accessWrite: "Write",
  action: "Action",
  builtIn: "Built-in",
  container: "Container",
  create: "Create",
  directory: "Directory",
  directoryUnavailable: "Directory unavailable.",
  directContainerLinks: "Direct container links",
  failedLoadDirectoryGroups: "Failed to load organization directory or groups.",
  failedLoadDataUsage: "Failed to load organization data usage.",
  failedLoadGrants: "Failed to load organization grants.",
  failedLoadGroupContainers: "Failed to load group container links.",
  failedLoadGroupMembers: "Failed to load group members.",
  failedLoadUserDetail: "Failed to load user detail.",
  grants: "Grants",
  grantsUnavailable: "Grants unavailable.",
  groupContainerLinks: "Group container links",
  group: "Group",
  groupName: "Group name",
  groups: "Groups",
  joined: "Joined",
  loadingDirectory: "Loading directory...",
  loadingDataUsage: "Loading data usage...",
  loadingGrants: "Loading grants...",
  loadingUserDetail: "Loading user detail...",
  members: "Members",
  noDirectUsers: "No direct users.",
  noDirectContainerLinks: "No direct container links.",
  noGroupContainerLinks: "No group container links.",
  noGroupMembers: "No group members.",
  noGroups: "No groups.",
  noMembershipChanges: "No membership changes.",
  noOrganizationContainerLinks: "No organization-level container links.",
  noPolicyHistory: "No policy history.",
  noUserContainerLinks: "No direct user container links.",
  noPolicy: "No policy",
  organization: "Organization",
  organizationContainerLinks: "Organization-level container links",
  organizationDataUsage: "Organization data usage",
  organizationPolicyHistory: "Organization policy history",
  policyChangeAdded: "added",
  policyChangeAddedAs: "added as",
  policyChangeChangedFrom: "changed from",
  policyChangeStatusAdded: "Added",
  policyChangeStatusRemoved: "Removed",
  policyChangeStatusRoleChanged: "Role changed",
  policyChangeRemoved: "removed",
  policyChangeTo: "to",
  policyHistory: "Policy history",
  policyHistoryUnavailable: "Policy history unavailable.",
  policyRoleNone: "none",
  policyRoleTransitionSeparator: "->",
  policySignedBy: "signed by",
  policyVersion: "Version",
  principal: "Principal",
  refresh: "Refresh",
  remove: "Remove",
  revoke: "Revoke",
  role: "Role",
  selectGroup: "Select a group.",
  selectUser: "Select a user.",
  self: "You",
  signingKey: "Signing key",
  uninitialized: "Uninitialized",
  updated: "Updated",
  usage: "Usage",
  usageBlob: "blob",
  usageBlobs: "Blobs",
  usageBlobsUnit: "blobs",
  usageBytesUnit: "bytes",
  usageData: "Data",
  usageDocument: "document",
  usageDocuments: "Documents",
  usageDocumentsUnit: "documents",
  usageTotal: "Total",
  usageUpdate: "update",
  usageUpdatesUnit: "updates",
  usageUnavailable: "Usage unavailable.",
  user: "User",
  userContainerLinks: "Direct user container links",
  userDetailUnavailable: "User detail unavailable.",
  userId: "User ID",
  userNotFound: "User not found.",
} as const;

export function getOrgManagerEpochLabel(keyEpoch: number): string {
  return `Epoch ${keyEpoch}`;
}

export function getOrgManagerMemberCountLabel(memberCount: number): string {
  return `${memberCount} member${memberCount === 1 ? "" : "s"}`;
}

export function getOrgManagerPolicyAddedLabel(
  memberLabel: string,
  role: string | null | undefined,
): string {
  return role
    ? `${memberLabel} ${ORG_MANAGER_LABELS.policyChangeAddedAs} ${role}`
    : `${memberLabel} ${ORG_MANAGER_LABELS.policyChangeAdded}`;
}

export function getOrgManagerPolicyRemovedLabel(memberLabel: string): string {
  return `${memberLabel} ${ORG_MANAGER_LABELS.policyChangeRemoved}`;
}

export function getOrgManagerPolicyChangeTypeLabel(
  changeType: "added" | "removed" | "role_changed",
): string {
  switch (changeType) {
    case "added":
      return ORG_MANAGER_LABELS.policyChangeStatusAdded;
    case "removed":
      return ORG_MANAGER_LABELS.policyChangeStatusRemoved;
    case "role_changed":
      return ORG_MANAGER_LABELS.policyChangeStatusRoleChanged;
    default:
      return changeType;
  }
}

export function getOrgManagerPolicyMemberTypeLabel(
  memberPrincipalType: "group" | "user",
): string {
  return memberPrincipalType === "group"
    ? ORG_MANAGER_LABELS.group
    : ORG_MANAGER_LABELS.user;
}

export function getOrgManagerPolicyRoleChangedLabel(
  memberLabel: string,
  previousRoleLabel: string,
  nextRoleLabel: string,
): string {
  return `${memberLabel} ${ORG_MANAGER_LABELS.policyChangeChangedFrom} ${previousRoleLabel} ${ORG_MANAGER_LABELS.policyChangeTo} ${nextRoleLabel}`;
}

export function getOrgManagerPolicyRoleLabel(
  role: string | null | undefined,
): string {
  return role ?? ORG_MANAGER_LABELS.policyRoleNone;
}

export function getOrgManagerPolicyRoleTransitionLabel(
  previousRoleLabel: string,
  nextRoleLabel: string,
): string {
  return `${previousRoleLabel} ${ORG_MANAGER_LABELS.policyRoleTransitionSeparator} ${nextRoleLabel}`;
}

export function getOrgManagerPolicySignatureLabel(
  signedAtLabel: string,
  signerLabel: string,
): string {
  return `${signedAtLabel} - ${ORG_MANAGER_LABELS.policySignedBy} ${signerLabel}`;
}

export function getOrgManagerPolicyVersionLabel(version: number): string {
  return `${ORG_MANAGER_LABELS.policyVersion} ${version}`;
}
