export const ORG_MANAGER_LABELS = {
  add: "Add",
  addUser: "Add user",
  authenticate: "Authenticate to manage an organization.",
  access: "Access",
  accessAdmin: "Admin",
  accessRead: "Read",
  accessWrite: "Write",
  action: "Action",
  active: "Active",
  back: "Back",
  billing: "Billing",
  billingActivationPending:
    "Activation can take a moment after purchase — refresh to check.",
  billingActive: "Active subscription",
  billingAdminOnly: "Only an organization admin can manage billing.",
  billingDeleting: "Deleting remote data",
  billingDisabled: "Sync disabled",
  billingLocal: "Local only",
  billingNoOptions: "No subscription options are available right now.",
  billingPastDue: "Payment past due",
  billingPurchaseUnavailable:
    "Purchases aren't available on this platform. Use the mobile app to subscribe.",
  billingPurged: "Remote data purged",
  billingRestore: "Restore purchases",
  billingRestoring: "Restoring...",
  billingStartTrial: "Start free trial",
  billingStartingTrial: "Starting trial...",
  billingSubscribe: "Subscribe",
  billingSubscribing: "Processing purchase...",
  billingSyncOff:
    "This organization is local-only. Subscribe to sync it across devices.",
  billingSyncOn: "Sync is on for this organization.",
  billingTitle: "Sync billing",
  billingTrialing: "Free trial",
  billingTrialUnavailable: "The free trial is no longer available.",
  billingUnavailable: "Billing unavailable.",
  builtIn: "Built-in",
  cancel: "Cancel",
  container: "Container",
  containerId: "Container ID",
  copyUserIdAction: "Copy user ID",
  created: "Created",
  create: "Create",
  creatingOrganization: "Creating organization...",
  clear: "Clear",
  columns: "Columns",
  columnsMenuStateOff: "Off",
  columnsMenuStateOn: "On",
  directory: "Roster",
  directoryUnavailable: "Roster unavailable.",
  directContainerLinks: "Direct container links",
  disabled: "Disabled",
  disabledAt: "Disabled at",
  disabledBy: "Disabled by",
  deleteGroupAction: "Delete Group",
  done: "Done",
  edit: "Edit",
  editRosterEntryAction: "Edit Roster Entry",
  failedLoadDirectoryGroups: "Failed to load organization roster or groups.",
  failedLoadDataUsage: "Failed to load organization data usage.",
  failedRestorePurchases: "Failed to restore purchases.",
  failedSubscribe: "Purchase failed.",
  failedLoadGrants: "Failed to load organization grants.",
  failedLoadGroupContainers: "Failed to load group container links.",
  failedLoadGroupMembers: "Failed to load group members.",
  failedLoadUserDetail: "Failed to load user detail.",
  failedCreateProfileDocument: "Failed to create profile document.",
  failedUpdateRosterEntry: "Failed to update roster entry.",
  firstName: "First name",
  grants: "Grants",
  grantDetail: "Grant Detail",
  grantsUnavailable: "Grants unavailable.",
  grantUnavailable: "Grant unavailable.",
  groupContainerLinks: "Group container links",
  group: "Group",
  groupName: "Group name",
  groups: "Groups",
  importUserAction: "Import User",
  importUserSubmitAction: "Import",
  importRosterEntryIntoContactsAction: "Import Into Contacts",
  joined: "Joined",
  lastName: "Last name",
  loadingBilling: "Loading billing...",
  loadingDirectory: "Loading roster...",
  loadingDataUsage: "Loading data usage...",
  loadingGrants: "Loading grants...",
  loadingOrganizationProfile: "Loading organization profile...",
  loadingProfileDocument: "Loading profile document...",
  loadingUserDetail: "Loading user detail...",
  members: "Members",
  metadataAccessEpoch: "Metadata access epoch",
  metadataAccessStateHash: "Metadata access state hash",
  metadataDocumentId: "Metadata document ID",
  nickname: "Nickname",
  noDirectUsers: "No roster entries.",
  noDirectContainerLinks: "No direct container links.",
  noGroupContainerLinks: "No group container links.",
  noGroupMembers: "No group members.",
  noGroups: "No groups.",
  noMembershipChanges: "No membership changes.",
  none: "None",
  noOrganizationContainerLinks: "No organization-level container links.",
  noPolicyHistory: "No policy history.",
  noUserContainerLinks: "No direct user container links.",
  noPolicy: "No policy",
  newGroupAction: "New Group",
  newOrganizationAction: "New Organization",
  organization: "Organization",
  organizations: "Organizations",
  organizationContainerLinks: "Organization-level container links",
  organizationDataUsage: "Organization data usage",
  organizationName: "Organization name",
  organizationPolicyHistory: "Organization policy history",
  organizationProfileUnavailable: "Organization profile unavailable.",
  openRosterEntryAction: "Open Roster Entry",
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
  profileDocument: "Profile document",
  profileDocumentId: "Profile document ID",
  profileDocumentUnavailable: "Profile document unavailable.",
  refresh: "Refresh",
  remove: "Remove",
  revoke: "Revoke",
  role: "Role",
  save: "Save",
  selectGroup: "Select a group.",
  selectUser: "Select a user.",
  self: "You",
  signingKey: "Signing key",
  status: "Status",
  subjectId: "Subject ID",
  subjectType: "Subject type",
  syncingOrganizationProfile: "Syncing organization profile...",
  syncingProfileDocument: "Syncing profile document...",
  uninitialized: "Uninitialized",
  unnamedOrganization: "Untitled organization",
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

export function getOrgManagerBillingStatusLabel(
  status:
    | "local"
    | "trialing"
    | "active"
    | "past_due"
    | "disabled"
    | "deleting"
    | "purged",
): string {
  switch (status) {
    case "local":
      return ORG_MANAGER_LABELS.billingLocal;
    case "trialing":
      return ORG_MANAGER_LABELS.billingTrialing;
    case "active":
      return ORG_MANAGER_LABELS.billingActive;
    case "past_due":
      return ORG_MANAGER_LABELS.billingPastDue;
    case "disabled":
      return ORG_MANAGER_LABELS.billingDisabled;
    case "deleting":
      return ORG_MANAGER_LABELS.billingDeleting;
    case "purged":
      return ORG_MANAGER_LABELS.billingPurged;
    default:
      return status;
  }
}

export function getOrgManagerTrialDaysLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"} left`;
}

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
