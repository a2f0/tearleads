// Margin for an in-flight rebind before irreversible deletion. GC's locked
// reachability recheck remains authoritative; eligibility is not a deadline.
export const DEFAULT_BLOB_GC_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
