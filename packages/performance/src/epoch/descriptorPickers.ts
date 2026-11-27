import type {
  EpochCanariesMetrics,
  EpochCanaryEntry,
  EpochScenarioEntry,
  EpochSnapshot,
} from "./schema";

function largestSharedRow<T>(
  beforeRows: readonly T[] | undefined,
  afterRows: readonly T[] | undefined,
  keyOf: (row: T) => string,
  rankOf: (row: T) => number,
): readonly [T, T] | undefined {
  if (!beforeRows || !afterRows) return undefined;
  const afterByKey = new Map(afterRows.map((row) => [keyOf(row), row]));
  let best: readonly [T, T] | undefined;
  let bestRank = -Infinity;
  for (const b of beforeRows) {
    const a = afterByKey.get(keyOf(b));
    if (!a) continue;
    const rank = rankOf(b);
    if (rank > bestRank) {
      bestRank = rank;
      best = [b, a];
    }
  }
  return best;
}

function sameSortedNames(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((name, idx) => name === sb[idx]);
}

function sumSharedEntries<T>(
  beforeEntries: readonly T[],
  afterEntries: readonly T[],
  nameOf: (entry: T) => string,
  pickValue: (entry: T) => number | null,
): readonly [number, number] | undefined {
  const afterByName = new Map(afterEntries.map((e) => [nameOf(e), e]));
  let beforeSum = 0;
  let afterSum = 0;
  let shared = 0;
  for (const b of beforeEntries) {
    const a = afterByName.get(nameOf(b));
    if (!a) continue;
    const bv = pickValue(b);
    const av = pickValue(a);
    if (bv === null || av === null) return undefined;
    beforeSum += bv;
    afterSum += av;
    shared += 1;
  }
  return shared > 0 ? [beforeSum, afterSum] : undefined;
}

function maxSharedEntries<T>(
  beforeEntries: readonly T[],
  afterEntries: readonly T[],
  nameOf: (entry: T) => string,
  pickValue: (entry: T) => number | null,
): readonly [number, number] | undefined {
  const afterByName = new Map(afterEntries.map((e) => [nameOf(e), e]));
  let beforeMax = -Infinity;
  let afterMax = -Infinity;
  let shared = 0;
  for (const b of beforeEntries) {
    const a = afterByName.get(nameOf(b));
    if (!a) continue;
    const bv = pickValue(b);
    const av = pickValue(a);
    if (bv === null || av === null) return undefined;
    if (bv > beforeMax) beforeMax = bv;
    if (av > afterMax) afterMax = av;
    shared += 1;
  }
  return shared > 0 ? [beforeMax, afterMax] : undefined;
}

export function sharedCanarySumPair(
  before: EpochSnapshot,
  after: EpochSnapshot,
  pickTotal: (c: EpochCanariesMetrics) => number | null,
  pickEntry: (e: EpochCanaryEntry) => number | null,
): readonly [number, number] | undefined {
  const bc = before.canaries;
  const ac = after.canaries;
  if (!bc || !ac) return undefined;
  if (bc.byCanary.length > 0 && ac.byCanary.length > 0) {
    return sumSharedEntries(
      bc.byCanary,
      ac.byCanary,
      (e) => e.canary,
      pickEntry,
    );
  }
  if (bc.byCanary.length > 0 || ac.byCanary.length > 0) return undefined;
  if (bc.canaryCount !== ac.canaryCount) return undefined;
  const bv = pickTotal(bc);
  const av = pickTotal(ac);
  return bv !== null && av !== null ? [bv, av] : undefined;
}

export function sharedCanaryMaxPair(
  before: EpochSnapshot,
  after: EpochSnapshot,
  pickTotal: (c: EpochCanariesMetrics) => number | null,
  pickEntry: (e: EpochCanaryEntry) => number | null,
): readonly [number, number] | undefined {
  const bc = before.canaries;
  const ac = after.canaries;
  if (!bc || !ac) return undefined;
  if (bc.byCanary.length > 0 && ac.byCanary.length > 0) {
    return maxSharedEntries(
      bc.byCanary,
      ac.byCanary,
      (e) => e.canary,
      pickEntry,
    );
  }
  if (bc.byCanary.length > 0 || ac.byCanary.length > 0) return undefined;
  if (bc.canaryCount !== ac.canaryCount) return undefined;
  const bv = pickTotal(bc);
  const av = pickTotal(ac);
  return bv !== null && av !== null ? [bv, av] : undefined;
}

export function matchingCanaryAggregatePair(
  before: EpochSnapshot,
  after: EpochSnapshot,
  pickTotal: (c: EpochCanariesMetrics) => number | null,
): readonly [number, number] | undefined {
  const bc = before.canaries;
  const ac = after.canaries;
  if (!bc || !ac) return undefined;
  if (bc.canaryCount !== ac.canaryCount) return undefined;
  if (
    !sameSortedNames(
      bc.byCanary.map((e) => e.canary),
      ac.byCanary.map((e) => e.canary),
    )
  ) {
    return undefined;
  }
  const bv = pickTotal(bc);
  const av = pickTotal(ac);
  return bv !== null && av !== null ? [bv, av] : undefined;
}

export function sharedScenarioSumPair(
  before: EpochSnapshot,
  after: EpochSnapshot,
  pickTotal: (s: NonNullable<EpochSnapshot["scenarios"]>) => number | null,
  pickEntry: (e: EpochScenarioEntry) => number | null,
): readonly [number, number] | undefined {
  const bs = before.scenarios;
  const as = after.scenarios;
  if (!bs || !as) return undefined;
  if (bs.byScenario.length > 0 && as.byScenario.length > 0) {
    return sumSharedEntries(
      bs.byScenario,
      as.byScenario,
      (e) => e.scenario,
      pickEntry,
    );
  }
  if (bs.byScenario.length > 0 || as.byScenario.length > 0) return undefined;
  if (bs.scenarioCount !== as.scenarioCount) return undefined;
  const bv = pickTotal(bs);
  const av = pickTotal(as);
  return bv !== null && av !== null ? [bv, av] : undefined;
}

export function settledReloadRow(snapshot: EpochSnapshot) {
  const settled = snapshot.reload?.filter((row) => row.reload === "settled");
  return settled && settled.length > 0
    ? [...settled].sort(
        (a, b) => b.documents - a.documents || b.folders - a.folders,
      )[0]
    : undefined;
}

export function sharedSettledReload(
  before: EpochSnapshot,
  after: EpochSnapshot,
) {
  return largestSharedRow(
    before.reload?.filter((row) => row.reload === "settled"),
    after.reload?.filter((row) => row.reload === "settled"),
    (r) => `${r.documents}:${r.folders}`,
    (r) => r.documents * 1_000_000 + r.folders,
  );
}

export function largestRealtimeDeclaration(snapshot: EpochSnapshot) {
  const decls = snapshot.realtime?.filter((row) => row.pass === "declaration");
  return decls && decls.length > 0
    ? [...decls].sort((a, b) => b.size - a.size)[0]
    : undefined;
}

export function sharedRealtimeDeclaration(
  before: EpochSnapshot,
  after: EpochSnapshot,
) {
  return largestSharedRow(
    before.realtime?.filter((row) => row.pass === "declaration"),
    after.realtime?.filter((row) => row.pass === "declaration"),
    (r) => `${r.size}`,
    (r) => r.size,
  );
}

export function largestRotationPhase(snapshot: EpochSnapshot, phase: string) {
  const rows = snapshot.rotations?.filter((row) => row.phase === phase);
  return rows && rows.length > 0
    ? [...rows].sort(
        (a, b) => b.rotations - a.rotations || b.depth - a.depth,
      )[0]
    : undefined;
}

export function sharedRotationPhase(
  before: EpochSnapshot,
  after: EpochSnapshot,
  phase: string,
) {
  return largestSharedRow(
    before.rotations?.filter((row) => row.phase === phase),
    after.rotations?.filter((row) => row.phase === phase),
    (r) => `${r.rotations}:${r.depth}`,
    (r) => r.rotations * 1000 + r.depth,
  );
}

export function largestBaselinePhase(snapshot: EpochSnapshot, phase: string) {
  const rows = snapshot.baselines?.filter((row) => row.phase === phase);
  return rows && rows.length > 0
    ? [...rows].sort(
        (a, b) => b.sizeMiB - a.sizeMiB || Number(b.race) - Number(a.race),
      )[0]
    : undefined;
}

export function sharedBaselinePhase(
  before: EpochSnapshot,
  after: EpochSnapshot,
  phase: string,
) {
  return largestSharedRow(
    before.baselines?.filter((row) => row.phase === phase),
    after.baselines?.filter((row) => row.phase === phase),
    (r) => `${r.sizeMiB}:${r.race}`,
    (r) => r.sizeMiB * 10 + (r.race ? 1 : 0),
  );
}
