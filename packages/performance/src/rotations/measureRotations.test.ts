import { expect, test } from "bun:test";
import { emptyHttpTraffic } from "../inProcess/httpCounterProxy";
import { emptyTraffic } from "../inProcess/postgresWire";
import { measureRotations } from "./measureRotations";
import type { RotationPhaseMeasurement } from "./runTier";

test("executes each rotation tier and sample in ascending order", async () => {
  const calls: string[] = [];
  const recorded: RotationPhaseMeasurement[] = [];

  await measureRotations({
    apiBaseUrl: "http://127.0.0.1:4001",
    trustOrigin: "http://127.0.0.1:4000",
    options: { rotations: [1, 4], depth: 3, samples: 2 },
    http: emptyHttpTraffic,
    traffic: emptyTraffic,
    measured: async (m) => {
      recorded.push(m);
    },
    runTier: async (tier) => {
      calls.push(`R=${tier.rotations} D=${tier.depth} #${tier.sample}`);
      await tier.measured({
        rotations: tier.rotations,
        depth: tier.depth,
        sample: tier.sample,
        phase: "group-shrink",
        wallMs: 100 * tier.rotations,
        http: {
          ...emptyHttpTraffic(),
          requests: 3 + tier.rotations,
        },
        database: {
          ...emptyTraffic(),
          statements: 20 * tier.rotations,
          roundTrips: 20 * tier.rotations,
        },
        resources: {
          cpuMs: 10,
          cpuUserMs: 8,
          peakHeapDeltaBytes: 1024,
          peakHeapBytes: 2048,
          peakRssDeltaBytes: 4096,
          peakRssBytes: 8192,
          samples: 2,
        },
      });
    },
  });

  expect(calls).toEqual([
    "R=1 D=3 #1",
    "R=1 D=3 #2",
    "R=4 D=3 #1",
    "R=4 D=3 #2",
  ]);
  expect(recorded).toHaveLength(4);
});
