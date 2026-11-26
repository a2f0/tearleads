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
import { type Canary, discoverCanaries, selectCanaries } from "./discover";
import { formatCanaryReport, formatComparison } from "./markdown";
import { type CanaryOptions, canaryUsage, parseCanaryOptions } from "./options";
import {
  type CanaryReport,
  type CanaryRun,
  canaryBoundary,
  loadCanaryReport,
} from "./report";
import { logTail, runCanary } from "./run";
import { comparePhases, summarizePhases } from "./summary";

type RunOptions = Extract<CanaryOptions, { mode: "run" }>;

/** `bun run --cwd` hides the caller's directory, so paths are from the root. */
function loadReport(path: string): Promise<CanaryReport> {
  return loadCanaryReport(resolve(repositoryRoot, path));
}

function compare(before: CanaryReport, after: CanaryReport): string {
  return formatComparison(comparePhases(before.summary, after.summary), {
    before: `run ${before.runId} at ${before.revision.slice(0, 12)}`,
    after: `run ${after.runId} at ${after.revision.slice(0, 12)}`,
  });
}

function printRun(run: CanaryRun): void {
  console.log(
    `${run.canary} #${run.sample}: ${run.status}, ${(run.wallMs / 1000).toFixed(1)} s`,
  );
  for (const phase of run.phases)
    console.log(
      `  ${phase.total} requests, ${phase.bodyBytes.request} B sent, ${phase.bodyBytes.response} B received: ${phase.label}`,
    );
}

/** Runs every sample of every canary in turn, saving the report after each. */
async function measure(
  canaries: readonly Canary[],
  options: RunOptions,
): Promise<CanaryReport> {
  const runId = crypto.randomUUID();
  const logs = await privateDirectory(
    resolve(reportDirectory, `canaries-${runId}`),
  );
  const runs: CanaryRun[] = [];
  const metadata = {
    schemaVersion: 1,
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
    options: { canaries: options.canaries, samples: options.samples },
    boundary: canaryBoundary,
  } as const;
  const report = (status: CanaryReport["status"]): CanaryReport => ({
    ...metadata,
    updatedAt: new Date().toISOString(),
    status,
    summary: summarizePhases(runs),
    runs,
  });
  console.log(
    `${canaries.length} canaries, ${options.samples} sample(s) each; logs in ${logs}`,
  );
  for (let sample = 1; sample <= options.samples; sample += 1)
    for (const canary of canaries) {
      const log = resolve(logs, `${canary.name}-${sample}.log`);
      const run = await runCanary({ canary, sample, log });
      runs.push(run);
      printRun(run);
      if (run.status !== "passed") console.log(await logTail(run.log));
      await saveJson(`canaries-${runId}.json`, report("running"));
    }
  return report(
    runs.every((run) => run.status === "passed") ? "complete" : "failed",
  );
}

async function main(): Promise<number> {
  const options = parseCanaryOptions(process.argv.slice(2));
  if (!options) {
    console.log(canaryUsage);
    return 0;
  }
  if (options.mode === "compare") {
    const [before, after] = await Promise.all([
      loadReport(options.before),
      loadReport(options.after),
    ]);
    console.log(compare(before, after));
    return 0;
  }
  // Read the baseline first, so a bad path fails before minutes of canaries.
  const baseline = options.baseline ? await loadReport(options.baseline) : null;
  const canaries = selectCanaries(await discoverCanaries(), options.canaries);
  const final = await measure(canaries, options);
  const comparison = baseline ? compare(baseline, final) : null;
  const jsonPath = await saveJson(`canaries-${final.runId}.json`, final);
  const markdownPath = await saveReportFile(
    `canaries-${final.runId}.md`,
    [formatCanaryReport(final), comparison].filter(Boolean).join("\n"),
  );
  if (comparison) console.log(`\n${comparison}`);
  console.log(`Report: ${jsonPath}\nMarkdown: ${markdownPath}`);
  return final.status === "complete" ? 0 : 1;
}

try {
  process.exit(await main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
