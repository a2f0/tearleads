export type BlobAuditRetentionMode = "live_only";
export type ContainerSyncTombstoneReason = "access_revoked" | "deleted";
export type DocumentAttachmentAuditAction =
  | "attach"
  | "replace"
  | "detach"
  | "rewrap";
export type OrganizationBillingProvider = "revenuecat";
export type OrganizationBillingSeatEventSourceType =
  | "billing_transition"
  | "principal_state"
  | "provider_event";
export type OrganizationBillingSeatEventType =
  | "seat_assigned"
  | "seat_released"
  | "licensed_seat_count_initialized"
  | "licensed_seat_count_increased"
  | "licensed_seat_count_decreased"
  | "licensed_seat_count_reset";
export type OrganizationBillingStatus =
  | "local"
  | "trialing"
  | "active"
  | "past_due"
  | "disabled"
  | "deleting"
  | "purged";
export type OrganizationRosterStatus = "active" | "disabled";
export type OrganizationReadModelLane =
  | "directory"
  | "grants"
  | "groupMemberships"
  | "groups"
  | "organizationPolicy";
export type OrganizationReadModelOperation = "delete" | "replace" | "upsert";
