export type BlobAuditRetentionMode = "live_only";
export type ContainerSyncTombstoneReason = "access_revoked" | "deleted";
export type DocumentAttachmentAuditAction =
  | "attach"
  | "replace"
  | "detach"
  | "rewrap";
export type OrganizationBillingProvider = "revenuecat";
export type OrganizationBillingStatus =
  | "local"
  | "trialing"
  | "active"
  | "past_due"
  | "disabled"
  | "deleting"
  | "purged";
export type OrganizationRosterStatus = "active" | "disabled";
