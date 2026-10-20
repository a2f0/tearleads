/** Whole milliseconds below a second, then tenths of a second, then minutes. */
export function formatDurationMs(durationMs: number): string {
  const milliseconds = Math.round(durationMs);
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 59.95) {
    return `${seconds.toFixed(1)} s`;
  }

  return `${(seconds / 60).toFixed(1)} min`;
}
