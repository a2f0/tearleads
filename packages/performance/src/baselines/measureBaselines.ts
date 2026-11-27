import type { HttpWireTraffic } from "../inProcess/httpCounterProxy";
import type { PostgresTraffic } from "../inProcess/postgresWire";
import type { BaselineOptions } from "./options";
import {
  type BaselinePhaseMeasurement,
  type HoldBeforeRequest,
  runBaselineTier,
} from "./runTier";

/** Runs every configured `(sizeMiB, sample)` tier in ascending size order. */
export async function measureBaselines(input: {
  readonly apiBaseUrl: string;
  readonly trustOrigin: string;
  readonly options: BaselineOptions;
  readonly http: () => HttpWireTraffic;
  readonly traffic: () => PostgresTraffic;
  readonly holdBeforeRequest: HoldBeforeRequest;
  readonly measured: (measurement: BaselinePhaseMeasurement) => Promise<void>;
  readonly runTier?: typeof runBaselineTier;
}): Promise<void> {
  const executeTier = input.runTier ?? runBaselineTier;
  for (const sizeMiB of input.options.sizesMb) {
    for (let sample = 1; sample <= input.options.samples; sample += 1) {
      await executeTier({
        apiBaseUrl: input.apiBaseUrl,
        trustOrigin: input.trustOrigin,
        sizeMiB,
        chunkMiB: input.options.chunkMb,
        race: input.options.race,
        sample,
        http: input.http,
        traffic: input.traffic,
        holdBeforeRequest: input.holdBeforeRequest,
        measured: input.measured,
      });
    }
  }
}
