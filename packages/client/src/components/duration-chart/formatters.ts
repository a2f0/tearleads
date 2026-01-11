/** @internal Exported for testing */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** @internal Exported for testing */
export function formatXAxisTick(timestamp: number, timeFilter: string): string {
  const date = new Date(timestamp);
  if (timeFilter === 'hour' || timeFilter === 'day') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
