/** Copy for the shared billing provider and app-shell billing warnings. */
export const BILLING_LABELS = {
  failedLoadBilling: "Failed to load organization billing.",
  failedStartTrial: "Failed to start the free trial.",
  bannerSyncPaused:
    "Sync is paused for this organization. Open Organization → Billing to resume.",
  bannerSyncSeatUnavailable:
    "This account can't sync because all licensed seats are in use. Ask an organization admin to free a seat or change plans.",
  bannerPastDue:
    "Your subscription payment is past due. Sync is paused until it's resolved.",
  bannerDeleting: "This organization's synced data is scheduled for deletion.",
  bannerPurged: "This organization's synced data has been purged.",
} as const;
