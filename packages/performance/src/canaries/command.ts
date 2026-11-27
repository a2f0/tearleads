import { cpus } from "node:os";
import { resolve } from "node:path";
import { sourceIdentity } from "../database/artifacts";
import {
  privateDirectory,
  reportDirectory,
  repositoryRoot,
  saveJson,
  saveReportFile,
} from "../reportFiles";
import { logTail } from "../testProcess";
import { type Canary, discoverCanaries, selectCanaries } from "./discover";
import { formatCanaryReport, formatComparison } from "./markdown";
import { type CanaryOptions, canaryUsage, parseCanaryOptions } from "./options";
import {
  type CanaryReport,
  type CanaryRun,
  canaryBoundary,
  loadCanaryReport,
} from "./report";
import { type CanaryRunInput, runCanary } from "./run";
import { phaseStatementCount } from "./runStatements";
import { comparePhases, summarizePhases } from "./summary";

type RunOptions = Extract<CanaryOptions, { mode: "run" }>;

/** What `perf:canaries` runs against; tests replace the canaries. */
export interface CanaryHost {
  readonly discover: () => Promise<Canary[]>;
  readonly runCanary: (input: CanaryRunInput) => Promise<CanaryRun>;
  /** Where reports, and each run's logs and captures, are saved. */
  readonly reportDirectory: string;
  readonly print: (text: string) => void;
}

const defaultHost: CanaryHost = {
  discover: discoverCanaries,
  runCanary,
  reportDirectory,
  print: (text) => console.log(text),
};

/** `bun run --cwd` hides the caller's directory, so paths are from the root. */
function loadReport(path: string): Promise<CanaryReport> {
  return loadCanaryReport(resolve(repositoryRoot, path));
}

function compare(before: CanaryReport, after: CanaryReport): string {
  return formatComparison(comparePhases(before.summary, after.summary), {
    before: reportLabel(before),
    after: reportLabel(after),
  });
}

/** A failed run's missing canaries show as removed, so its label says so. */
function reportLabel(report: CanaryReport): string {
  const label = `run ${report.runId} at ${report.revision.slice(0, 12)}`;
  return report.status === "complete" ? label : `${label} (${report.status})`;
}

function describeRun(run: CanaryRun): string {
  const lines = [
    `${run.canary} #${run.sample}: ${run.status}, ${(run.wallMs / 1000).toFixed(1)} s`,
  ];
  for (const [index, phase] of run.phases.entries()) {
    const statements = phaseStatementCount(run.statements, index);
    lines.push(
      `  ${phase.total} requests, ${phase.bodyBytes.request} B sent, ${phase.bodyBytes.response} B received${statements === undefined ? "" : `, ${statements} statements`}: ${phase.label}`,
    );
  }
  if (run.statements.status === "unmatched")
    lines.push(
      `  The statement capture is missing, unreadable, or its phase markers do not match the profile; no per-phase statements. Capture: ${run.statements.capture}`,
    );
  return lines.join("\n");
}

/** Runs every sample of every canary in turn, saving the report after each. */
async function measure(
  canaries: readonly Canary[],
  options: RunOptions,
  host: CanaryHost,
): Promise<CanaryReport> {
  const runId = crypto.randomUUID();
  const logs = await privateDirectory(
    resolve(host.reportDirectory, `canaries-${runId}`),
  );
  const runs: CanaryRun[] = [];
  const metadata = {
    schemaVersion: 2,
    scenario: "request-volume-canaries",
    runId,
    startedAt: new Date().toISOString(),
    ...sourceIdentity(),
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
    options: {
      canaries: options.canaries,
      samples: options.samples,
      statements: options.statements,
      paramHash: options.paramHash,
      payloadAudit: options.payloadAudit,
      stacks: options.stacks,
    },
    boundary: canaryBoundary,
  } as const;
  const report = (status: CanaryReport["status"]): CanaryReport => ({
    ...metadata,
    updatedAt: new Date().toISOString(),
    status,
    // A failed run's phases would skew the ranges; its log shows them.
    summary: summarizePhases(runs.filter((run) => run.status === "passed")),
    runs,
  });
  host.print(
    `${canaries.length} canaries, ${options.samples} sample(s) each; logs in ${logs}`,
  );
  for (let sample = 1; sample <= options.samples; sample += 1)
    for (const canary of canaries) {
      const name = `${canary.name}-${sample}`;
      const run = await host.runCanary({
        canary,
        sample,
        log: resolve(logs, `${name}.log`),
        ...(options.statements && {
          capture: {
            out: resolve(logs, `${name}.statements.jsonl`),
            paramHash: options.paramHash,
          },
        }),
        ...(options.payloadAudit && {
          payloadAudit: {
            out: resolve(logs, `${name}.payloads.jsonl`),
            stacks: options.stacks,
          },
        }),
      });
      runs.push(run);
      host.print(describeRun(run));
      if (run.status !== "passed") host.print(await logTail(run.log));
      await saveJson(
        `canaries-${runId}.json`,
        report("running"),
        host.reportDirectory,
      );
    }
  return report(
    runs.every((run) => run.status === "passed") ? "complete" : "failed",
  );
}

/**
 * `perf:canaries`: compares two saved reports, or runs the canaries and
 * saves a report. Exits 1 when any run did not pass.
 */
export async function runCanaryCommand(
  args: string[],
  host = defaultHost,
): Promise<number> {
  const options = parseCanaryOptions(args);
  if (!options) {
    host.print(canaryUsage);
    return 0;
  }
  if (options.mode === "compare") {
    const [before, after] = await Promise.all([
      loadReport(options.before),
      loadReport(options.after),
    ]);
    host.print(compare(before, after));
    return 0;
  }
  // Read the baseline first, so a bad path fails before minutes of canaries.
  const baseline = options.baseline ? await loadReport(options.baseline) : null;
  const canaries = selectCanaries(await host.discover(), options.canaries);
  const final = await measure(canaries, options, host);
  // Save before comparing, so a comparison that throws cannot lose the run.
  const jsonPath = await saveJson(
    `canaries-${final.runId}.json`,
    final,
    host.reportDirectory,
  );
  const comparison = baseline ? compare(baseline, final) : null;
  const markdownPath = await saveReportFile(
    `canaries-${final.runId}.md`,
    [formatCanaryReport(final), comparison].filter(Boolean).join("\n"),
    host.reportDirectory,
  );
  if (comparison) host.print(`\n${comparison}`);
  host.print(`Report: ${jsonPath}\nMarkdown: ${markdownPath}`);
  return final.status === "complete" ? 0 : 1;
}
