export type AccountStatus =
  | "trialing"
  | "active"
  | "disabled"
  | "deleting"
  | "purged";
export type BlobAuditRetentionMode = "live_only";
export type ContainerSyncTombstoneReason = "access_revoked" | "deleted";
export type DocumentAttachmentAuditAction =
  | "attach"
  | "replace"
  | "detach"
  | "rewrap";
export type OrganizationRosterStatus = "active" | "disabled";
