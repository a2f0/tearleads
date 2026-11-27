import type { PhaseMetrics } from "./output";
import { phaseStatementCount, type RunStatements } from "./runStatements";

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** One phase of one canary across every sample that printed it. */
export interface PhaseSummary {
  readonly canary: string;
  readonly label: string;
  /** Which phase with this label in the canary's output: 0 for the first. */
  readonly occurrence: number;
  readonly samples: number;
  readonly requests: Range;
  readonly requestBytes: Range;
  readonly responseBytes: Range;
  /** API statements in the phase, when every sample captured them. */
  readonly statements: Range | null;
  /** Per endpoint; a sample without the endpoint counts 0 for each. */
  readonly byRequest: Readonly<Record<string, EndpointSummary>>;
}

export interface EndpointSummary {
  readonly count: Range;
  readonly requestBytes: Range;
  readonly responseBytes: Range;
}

export interface CanarySample {
  readonly canary: string;
  readonly phases: readonly PhaseMetrics[];
  readonly statements?: RunStatements;
}

function range(values: readonly number[]): Range {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function capturedRange(counts: readonly (number | undefined)[]): Range | null {
  const captured = counts.filter((count) => count !== undefined);
  return captured.length === counts.length ? range(captured) : null;
}

function sortedKeys(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function phaseKey(phase: {
  readonly canary: string;
  readonly label: string;
  readonly occurrence: number;
}): string {
  return JSON.stringify([phase.canary, phase.label, phase.occurrence]);
}

/**
 * Groups the phases of every sample by canary, label and occurrence, in the
 * order they first appear, and reduces each group to ranges.
 */
export function summarizePhases(
  samples: readonly CanarySample[],
): PhaseSummary[] {
  const groups = new Map<
    string,
    {
      canary: string;
      label: string;
      occurrence: number;
      phases: PhaseMetrics[];
      statements: (number | undefined)[];
    }
  >();
  for (const sample of samples) {
    const seen = new Map<string, number>();
    for (const [index, phase] of sample.phases.entries()) {
      const occurrence = seen.get(phase.label) ?? 0;
      seen.set(phase.label, occurrence + 1);
      const identity = {
        canary: sample.canary,
        label: phase.label,
        occurrence,
      };
      const key = phaseKey(identity);
      const group = groups.get(key) ?? {
        ...identity,
        phases: [],
        statements: [],
      };
      group.phases.push(phase);
      group.statements.push(phaseStatementCount(sample.statements, index));
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ phases, statements, ...identity }) => ({
    ...identity,
    samples: phases.length,
    requests: range(phases.map((phase) => phase.total)),
    requestBytes: range(phases.map((phase) => phase.bodyBytes.request)),
    responseBytes: range(phases.map((phase) => phase.bodyBytes.response)),
    statements: capturedRange(statements),
    byRequest: Object.fromEntries(
      sortedKeys(phases.flatMap((phase) => Object.keys(phase.byRequest))).map(
        (request) => {
          const entries = phases.map((phase) => phase.byRequest[request]);
          return [
            request,
            {
              count: range(entries.map((entry) => entry?.count ?? 0)),
              requestBytes: range(
                entries.map((entry) => entry?.bodyBytes.request ?? 0),
              ),
              responseBytes: range(
                entries.map((entry) => entry?.bodyBytes.response ?? 0),
              ),
            },
          ];
        },
      ),
    ),
  }));
}

export interface EndpointChange {
  readonly request: string;
  readonly before: EndpointSummary;
  readonly after: EndpointSummary;
}

export interface PhaseChange {
  readonly canary: string;
  readonly label: string;
  readonly occurrence: number;
  readonly before: PhaseSummary | null;
  readonly after: PhaseSummary | null;
  /** Endpoints whose count or byte ranges differ. */
  readonly endpoints: readonly EndpointChange[];
}

const zero: Range = { min: 0, max: 0 };
const absent: EndpointSummary = {
  count: zero,
  requestBytes: zero,
  responseBytes: zero,
};
const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;
const sameEndpoint = (a: EndpointSummary, b: EndpointSummary) =>
  sameRange(a.count, b.count) &&
  sameRange(a.requestBytes, b.requestBytes) &&
  sameRange(a.responseBytes, b.responseBytes);

/** Pairs phases by canary, label and occurrence; unmatched phases pair with null. */
export function comparePhases(
  before: readonly PhaseSummary[],
  after: readonly PhaseSummary[],
): PhaseChange[] {
  const afterByKey = new Map(after.map((phase) => [phaseKey(phase), phase]));
  const beforeKeys = new Set(before.map(phaseKey));
  const pairs: [PhaseSummary | null, PhaseSummary | null][] = [
    ...before.map((phase): [PhaseSummary, PhaseSummary | null] => [
      phase,
      afterByKey.get(phaseKey(phase)) ?? null,
    ]),
    ...after
      .filter((phase) => !beforeKeys.has(phaseKey(phase)))
      .map((phase): [null, PhaseSummary] => [null, phase]),
  ];
  return pairs.map(([was, now]) => {
    const identity = now ?? was;
    if (!identity) throw new Error("A phase pair is empty.");
    const requests = sortedKeys([
      ...Object.keys(was?.byRequest ?? {}),
      ...Object.keys(now?.byRequest ?? {}),
    ]);
    return {
      canary: identity.canary,
      label: identity.label,
      occurrence: identity.occurrence,
      before: was,
      after: now,
      endpoints: requests
        .map((request) => ({
          request,
          before: was?.byRequest[request] ?? absent,
          after: now?.byRequest[request] ?? absent,
        }))
        .filter((change) => !sameEndpoint(change.before, change.after)),
    };
  });
}

/** Whether a pair changed in requests, bytes, or presence. */
export function phaseChanged(change: PhaseChange): boolean {
  const { before, after } = change;
  if (!before || !after) return true;
  return (
    change.endpoints.length > 0 ||
    !sameRange(before.requests, after.requests) ||
    !sameRange(before.requestBytes, after.requestBytes) ||
    !sameRange(before.responseBytes, after.responseBytes) ||
    (before.statements !== null &&
      after.statements !== null &&
      !sameRange(before.statements, after.statements))
  );
}
