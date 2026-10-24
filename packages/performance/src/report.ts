import type { CostEvent } from "./costEvents";
import type { Sample } from "./provision";

export function summarize(samples: Sample[]) {
  const passed = samples.filter((sample) => sample.status === "passed");
  const durations = passed
    .map((sample) =>
      sample.phases
        .filter((phase) =>
          ["identity", "registration", "login"].includes(phase.name),
        )
        .reduce((sum, phase) => sum + phase.durationMs, 0),
    )
    .sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    durations[Math.ceil(durations.length * fraction) - 1] ?? null;
  return {
    attempted: samples.length,
    passed: passed.length,
    failed: samples.length - passed.length,
    provisionMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: durations.at(-1) ?? null,
    },
  };
}

export function sampleSummary(sample: Sample, costs: CostEvent[]): string {
  const milliseconds = (value: number | null) =>
    value === null ? "unavailable" : `${value.toFixed(1)} ms`;
  const lines = [
    `${sample.id}: ${sample.status}${sample.failurePhase ? ` (${sample.failurePhase})` : ""}`,
  ];
  for (const phase of sample.phases)
    lines.push(`  ${phase.name}: ${milliseconds(phase.durationMs)}`);
  for (const request of sample.requests) {
    const cost = costs.find((event) => event.requestId === request.id)
      ?.costs[0];
    lines.push(
      `  ${request.method} ${request.route} [${request.status ?? request.outcome}]: headers ${milliseconds(request.headersMs)}, server ${milliseconds(request.serverMs)}, DB ${milliseconds(request.databaseMs)}${cost ? `, ${cost.statements} statements` : ""}`,
    );
  }
  return lines.join("\n");
}
