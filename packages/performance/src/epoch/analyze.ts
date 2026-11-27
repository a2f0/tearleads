import {
  epochMetricDescriptors,
  type MetricDescriptor,
  type MetricDimension,
} from "./descriptors";
import type { EpochSnapshot } from "./schema";

export type MetricVerdict = "improved" | "regressed" | "unchanged" | "changed";

export interface MetricDelta {
  readonly key: string;
  readonly dimension: MetricDimension;
  readonly label: string;
  readonly unit: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly verdict: MetricVerdict;
}

export interface DimensionTradeoff {
  readonly improvedDimension: MetricDimension;
  readonly regressedDimension: MetricDimension;
  readonly improvedSummary: string;
  readonly regressedSummary: string;
}

export interface EpochComparison {
  readonly beforeId: string;
  readonly afterId: string;
  readonly beforeRevision: string;
  readonly afterRevision: string;
  readonly metrics: readonly MetricDelta[];
  readonly improvements: readonly MetricDelta[];
  readonly regressions: readonly MetricDelta[];
  readonly tradeoffs: readonly DimensionTradeoff[];
}

function classifyMetric(
  descriptor: MetricDescriptor,
  before: number,
  after: number,
): MetricDelta {
  const delta = Math.round((after - before) * 10) / 10;
  const deltaPct =
    before === 0
      ? after === 0
        ? 0
        : null
      : Math.round(((after - before) / before) * 1000) / 10;
  if (delta === 0) {
    return {
      key: descriptor.key,
      dimension: descriptor.dimension,
      label: descriptor.label,
      unit: descriptor.unit,
      before,
      after,
      delta: 0,
      deltaPct: 0,
      verdict: "unchanged",
    };
  }
  const absPct = deltaPct === null ? Infinity : Math.abs(deltaPct);
  if (
    descriptor.noiseThresholdPct > 0 &&
    absPct < descriptor.noiseThresholdPct
  ) {
    return {
      key: descriptor.key,
      dimension: descriptor.dimension,
      label: descriptor.label,
      unit: descriptor.unit,
      before,
      after,
      delta,
      deltaPct,
      verdict: "unchanged",
    };
  }
  const verdict: MetricVerdict =
    descriptor.direction === "neutral"
      ? "changed"
      : delta < 0
        ? "improved"
        : "regressed";
  return {
    key: descriptor.key,
    dimension: descriptor.dimension,
    label: descriptor.label,
    unit: descriptor.unit,
    before,
    after,
    delta,
    deltaPct,
    verdict,
  };
}

function summarizeDimensionMoves(deltas: readonly MetricDelta[]): string {
  return deltas
    .slice(0, 3)
    .map((item) => {
      const sign = item.delta > 0 ? "+" : "";
      const pct = item.deltaPct === null ? "" : ` (${sign}${item.deltaPct}%)`;
      return `${item.label}: ${sign}${item.delta} ${item.unit}${pct}`;
    })
    .join("; ");
}

function detectTradeoffs(
  improvements: readonly MetricDelta[],
  regressions: readonly MetricDelta[],
): DimensionTradeoff[] {
  if (improvements.length === 0 || regressions.length === 0) return [];
  const impByDim = new Map<MetricDimension, MetricDelta[]>();
  const regByDim = new Map<MetricDimension, MetricDelta[]>();
  for (const item of improvements) {
    impByDim.set(item.dimension, [
      ...(impByDim.get(item.dimension) ?? []),
      item,
    ]);
  }
  for (const item of regressions) {
    regByDim.set(item.dimension, [
      ...(regByDim.get(item.dimension) ?? []),
      item,
    ]);
  }
  const tradeoffs: DimensionTradeoff[] = [];
  for (const [impDim, impList] of impByDim) {
    for (const [regDim, regList] of regByDim) {
      tradeoffs.push({
        improvedDimension: impDim,
        regressedDimension: regDim,
        improvedSummary: summarizeDimensionMoves(impList),
        regressedSummary: summarizeDimensionMoves(regList),
      });
    }
  }
  return tradeoffs;
}

/** Compares two Epoch 2 snapshots across all shared metrics, surfacing tradeoffs. */
export function compareSnapshots(
  before: EpochSnapshot,
  after: EpochSnapshot,
): EpochComparison {
  const metrics: MetricDelta[] = [];
  for (const descriptor of epochMetricDescriptors) {
    if (descriptor.pickPair) {
      const pair = descriptor.pickPair(before, after);
      if (pair) metrics.push(classifyMetric(descriptor, pair[0], pair[1]));
      continue;
    }
    const beforeVal = descriptor.pick(before);
    const afterVal = descriptor.pick(after);
    if (
      beforeVal === undefined ||
      beforeVal === null ||
      afterVal === undefined ||
      afterVal === null
    ) {
      continue;
    }
    metrics.push(classifyMetric(descriptor, beforeVal, afterVal));
  }
  const improvements = metrics.filter((item) => item.verdict === "improved");
  const regressions = metrics.filter((item) => item.verdict === "regressed");
  return {
    beforeId: before.id,
    afterId: after.id,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    metrics,
    improvements,
    regressions,
    tradeoffs: detectTradeoffs(improvements, regressions),
  };
}
