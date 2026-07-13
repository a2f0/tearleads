// Progress + cancellation contract shared by the recursive purge engine and its
// store wrappers ("Delete Forever" and "Empty Trash"). onProgress reports
// ABSOLUTE counts (not deltas) so a determinate progress bar can render
// completed/total directly; a fresh object is emitted each tick so a
// referential-equality state setter never drops an update. signal cancels at the
// next unit boundary — between whole documents / whole containers, never
// mid-remote-call — so a cancelled run always stops on a consistent prefix that
// re-running can safely resume.
export interface PurgeProgress {
  readonly completedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
}

export interface PurgeOptions {
  onProgress?: ((progress: PurgeProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
}
