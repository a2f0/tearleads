import type { AuthorizationCall } from "./hubSocket";
import { productionBudgetMs } from "./hubSocket";
import type { PostgresTraffic } from "./postgresWire";
import { trafficSince } from "./postgresWire";
import { type ResourceUse, startResourceSampler } from "./resources";

export type HubPass = "declaration" | "revalidation";

export interface PassMeasurement {
  readonly pass: HubPass;
  readonly size: number;
  readonly sample: number;
  readonly authorized: number;
  readonly evicted: number;
  /** From handing the hub the message or tick until the pass completed. */
  readonly durationMs: number;
  /** Time inside the hub's database transaction and proof checks. */
  readonly authorizationMs: number;
  readonly authorizationCalls: number;
  /** The deadline production gives a declaration of this many ids. */
  readonly productionBudgetMs: number;
  readonly database: PostgresTraffic;
  readonly resources: ResourceUse;
  /** The hibernation snapshot the hub stores for the socket afterwards. */
  readonly snapshot?: { readonly characters: number; readonly chunks: number };
}

interface PassOutcome {
  readonly authorized: number;
  readonly evicted?: number;
  readonly calls: readonly AuthorizationCall[];
}

const round = (value: number) => Math.round(value * 10) / 10;

export async function measurePass(input: {
  readonly pass: HubPass;
  readonly size: number;
  readonly sample: number;
  readonly traffic: () => PostgresTraffic;
  readonly run: () => Promise<PassOutcome>;
}): Promise<PassMeasurement> {
  const sampler = startResourceSampler();
  const before = input.traffic();
  const started = performance.now();
  let outcome: PassOutcome;
  try {
    outcome = await input.run();
  } catch (error) {
    sampler.stop();
    throw error;
  }
  const durationMs = round(performance.now() - started);
  const database = trafficSince(input.traffic(), before);
  const resources = sampler.stop();
  if (outcome.authorized !== input.size)
    throw new Error(
      `The ${input.pass} authorized ${outcome.authorized} of ${input.size} folders.`,
    );
  return {
    pass: input.pass,
    size: input.size,
    sample: input.sample,
    authorized: outcome.authorized,
    evicted: outcome.evicted ?? 0,
    durationMs,
    authorizationMs: round(
      outcome.calls.reduce((total, call) => total + call.durationMs, 0),
    ),
    authorizationCalls: outcome.calls.length,
    productionBudgetMs: productionBudgetMs(input.size),
    database,
    resources,
  };
}
