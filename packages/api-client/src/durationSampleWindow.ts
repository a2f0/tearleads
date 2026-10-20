/** Recent percentiles plus all-time totals for one endpoint's durations. */
export interface ApiRequestDurationSummary {
  /** Durations recorded since reset. */
  readonly samples: number;
  /** Sum of every recorded duration since reset. */
  readonly totalMs: number;
  /** Nearest-rank percentiles over the most recent samples only. */
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** Largest duration since reset, including samples outside the window. */
  readonly maxMs: number;
}

export const DURATION_SAMPLE_WINDOW_SIZE = 256;

function nearestRank(sorted: readonly number[], percentile: number): number {
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? 0;
}

/**
 * A fixed-size ring of recent durations, so a long session keeps bounded
 * memory and sorts at most DURATION_SAMPLE_WINDOW_SIZE values per update.
 */
export class DurationSampleWindow {
  private readonly recent: number[] = [];
  private nextSlot = 0;
  private samples = 0;
  private totalMs = 0;
  private maxMs = 0;

  record(durationMs: number): void {
    const sample = Math.max(0, durationMs);
    if (this.recent.length < DURATION_SAMPLE_WINDOW_SIZE) {
      this.recent.push(sample);
    } else {
      this.recent[this.nextSlot] = sample;
      this.nextSlot = (this.nextSlot + 1) % DURATION_SAMPLE_WINDOW_SIZE;
    }
    this.samples += 1;
    this.totalMs += sample;
    this.maxMs = Math.max(this.maxMs, sample);
  }

  summarize(): ApiRequestDurationSummary | null {
    if (this.samples === 0) return null;
    const sorted = [...this.recent].sort((left, right) => left - right);
    return {
      samples: this.samples,
      totalMs: this.totalMs,
      p50Ms: nearestRank(sorted, 0.5),
      p95Ms: nearestRank(sorted, 0.95),
      maxMs: this.maxMs,
    };
  }
}
