/** Copy for the shared billing provider and the app-shell billing banner. */
export const BILLING_LABELS = {
  failedLoadBilling: "Failed to load organization billing.",
  failedStartTrial: "Failed to start the free trial.",
  bannerSyncPaused:
    "Sync is paused for this organization. Open Organization → Billing to resume.",
  bannerPastDue:
    "Your subscription payment is past due. Sync is paused until it's resolved.",
  bannerDeleting: "This organization's synced data is scheduled for deletion.",
  bannerPurged: "This organization's synced data has been purged.",
} as const;

/** Trial countdown line for the banner, e.g. "3 days in free trial". */
export function getBillingTrialBannerLabel(days: number): string {
  const unit = days === 1 ? "day" : "days";
  return `${days} ${unit} in free trial`;
}

/** Call to action after the trial countdown; links to Organization → Billing. */
export const BILLING_TRIAL_ENROLL_LABEL = "Enroll";
