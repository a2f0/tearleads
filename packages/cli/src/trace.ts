import { printable } from "./printable";

/**
 * Timestamped progress lines on stderr for `--trace`. Each line carries the
 * wall-clock time and the seconds since the command started, so slow steps
 * stand out. A disabled tracer records nothing.
 */
export interface Tracer {
  readonly enabled: boolean;
  /** Writes one line. */
  event(message: string): void;
  /** Writes start and end lines around `work`, with its duration. */
  span<T>(name: string, work: () => Promise<T>): Promise<T>;
  /** Adds one API request's duration to the end-of-command summary. */
  recordRequest(endpoint: string, durationMs: number): void;
  /** Writes the phase and slowest-endpoint totals. */
  summary(): void;
}

interface TracerOptions {
  readonly enabled: boolean;
  readonly now?: () => number;
  readonly clock?: () => Date;
  readonly write?: (line: string) => void;
}

const SUMMARY_ENDPOINTS = 10;

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function createTracer(options: TracerOptions): Tracer {
  const now = options.now ?? (() => performance.now());
  const clock = options.clock ?? (() => new Date());
  const write =
    options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const startedAt = now();
  const phases: { name: string; ms: number }[] = [];
  const endpoints = new Map<string, { count: number; totalMs: number }>();

  const event = (message: string) => {
    if (!options.enabled) return;
    const elapsed = ((now() - startedAt) / 1000).toFixed(3).padStart(8);
    const prefix = `${clock().toISOString()} +${elapsed}s  `;
    // Multi-line text (stack traces) keeps one timestamped line per line.
    for (const line of message.split(/\r?\n/u)) {
      write(`${prefix}${printable(line)}`);
    }
  };

  return {
    enabled: options.enabled,
    event,
    async span(name, work) {
      if (!options.enabled) return work();
      const spanStart = now();
      event(`${name} ...`);
      try {
        const result = await work();
        const ms = now() - spanStart;
        phases.push({ name, ms });
        event(`${name} done in ${formatDuration(ms)}`);
        return result;
      } catch (error) {
        const ms = now() - spanStart;
        phases.push({ name: `${name} (failed)`, ms });
        event(`${name} failed after ${formatDuration(ms)}`);
        throw error;
      }
    },
    recordRequest(endpoint, durationMs) {
      if (!options.enabled) return;
      const totals = endpoints.get(endpoint) ?? { count: 0, totalMs: 0 };
      endpoints.set(endpoint, {
        count: totals.count + 1,
        totalMs: totals.totalMs + durationMs,
      });
    },
    summary() {
      if (!options.enabled) return;
      event(`summary: total ${formatDuration(now() - startedAt)}`);
      for (const phase of phases) {
        event(`  phase ${phase.name}: ${formatDuration(phase.ms)}`);
      }
      const rows = [...endpoints.entries()].sort(
        (left, right) => right[1].totalMs - left[1].totalMs,
      );
      const requests = rows.reduce((sum, [, row]) => sum + row.count, 0);
      event(`  ${requests} API request(s) across ${rows.length} endpoint(s)`);
      for (const [endpoint, row] of rows.slice(0, SUMMARY_ENDPOINTS)) {
        event(
          `  ${endpoint}: ${row.count}x, ${formatDuration(row.totalMs)} total, ${formatDuration(row.totalMs / row.count)} avg`,
        );
      }
    },
  };
}

export const disabledTracer: Tracer = createTracer({ enabled: false });
