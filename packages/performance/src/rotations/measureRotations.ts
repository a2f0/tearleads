import type { HttpWireTraffic } from "../inProcess/httpCounterProxy";
import type { PostgresTraffic } from "../inProcess/postgresWire";
import type { RotationOptions } from "./options";
import { type RotationPhaseMeasurement, runRotationTier } from "./runTier";

/** Runs every configured `(rotations, sample)` tier in ascending order. */
export async function measureRotations(input: {
  readonly apiBaseUrl: string;
  readonly trustOrigin: string;
  readonly options: RotationOptions;
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly measured: (measurement: RotationPhaseMeasurement) => Promise<void>;
  readonly runTier?: typeof runRotationTier;
}): Promise<void> {
  const executeTier = input.runTier ?? runRotationTier;
  for (const rotations of input.options.rotations) {
    for (let sample = 1; sample <= input.options.samples; sample += 1) {
      await executeTier({
        apiBaseUrl: input.apiBaseUrl,
        trustOrigin: input.trustOrigin,
        rotations,
        depth: input.options.depth,
        sample,
        http: input.http,
        traffic: input.traffic,
        measured: input.measured,
      });
    }
  }
}
