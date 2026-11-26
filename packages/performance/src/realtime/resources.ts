const SAMPLE_INTERVAL_MS = 5;

export interface ResourceUse {
  /** Process CPU over the pass, user plus system, all threads. */
  cpuMs: number;
  cpuUserMs: number;
  /** Peak sampled JavaScript heap in use, above the collected baseline. */
  peakHeapDeltaBytes: number;
  peakHeapBytes: number;
  /** Peak sampled resident set size, above the collected baseline. */
  peakRssDeltaBytes: number;
  peakRssBytes: number;
  samples: number;
}

interface ResourceRuntime {
  readonly collect: () => void;
  readonly cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  readonly memoryUsage: () => { heapUsed: number; rss: number };
}

const processRuntime: ResourceRuntime = {
  collect: () => Bun.gc(true),
  cpuUsage: (previous) => process.cpuUsage(previous),
  memoryUsage: () => process.memoryUsage(),
};

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Samples memory at event-loop turns, every few milliseconds, from a collected
 * baseline. A synchronous stretch between two awaits is not sampled inside,
 * so the peaks are lower bounds.
 */
export function startResourceSampler(runtime = processRuntime) {
  runtime.collect();
  const baseline = runtime.memoryUsage();
  let peakHeap = baseline.heapUsed;
  let peakRss = baseline.rss;
  let samples = 0;
  const sample = () => {
    const usage = runtime.memoryUsage();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
    samples++;
  };
  const cpu = runtime.cpuUsage();
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  return {
    stop(): ResourceUse {
      clearInterval(timer);
      sample();
      const used = runtime.cpuUsage(cpu);
      return {
        cpuMs: round((used.user + used.system) / 1000),
        cpuUserMs: round(used.user / 1000),
        peakHeapDeltaBytes: peakHeap - baseline.heapUsed,
        peakHeapBytes: peakHeap,
        peakRssDeltaBytes: peakRss - baseline.rss,
        peakRssBytes: peakRss,
        samples,
      };
    },
  };
}
