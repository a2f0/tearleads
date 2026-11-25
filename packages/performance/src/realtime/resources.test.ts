import { expect, test } from "bun:test";
import { startResourceSampler } from "./resources";

test("reports CPU and peak memory above the collected baseline", async () => {
  const usage = [
    { heapUsed: 100, rss: 1_000 },
    { heapUsed: 400, rss: 1_500 },
    { heapUsed: 250, rss: 1_200 },
  ];
  let reads = 0;
  let collected = 0;
  const sampler = startResourceSampler({
    collect: () => {
      collected++;
    },
    cpuUsage: (previous) =>
      previous
        ? { user: 3_000, system: 1_500 }
        : { user: 50_000, system: 20_000 },
    memoryUsage: () =>
      usage[Math.min(reads++, usage.length - 1)] ?? { heapUsed: 0, rss: 0 },
  });
  await Bun.sleep(20);
  const used = sampler.stop();
  expect(collected).toBe(1);
  expect(used).toMatchObject({
    cpuMs: 4.5,
    cpuUserMs: 3,
    peakHeapBytes: 400,
    peakHeapDeltaBytes: 300,
    peakRssBytes: 1_500,
    peakRssDeltaBytes: 500,
  });
  expect(used.samples).toBeGreaterThanOrEqual(2);
});
