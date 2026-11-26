import { readFile, stat } from "node:fs/promises";
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
import {
  logTail,
  packagePreloads,
  runTestProcess,
  testFileArgument,
} from "../testProcess";
import { formatStatementSummary } from "./markdown";
import { parseStatementOptions, statementUsage } from "./options";
import { parseCapture, summarizeCapture } from "./summary";

const capturePreload = resolve(import.meta.dir, "capturePreload.ts");
/** A focused run takes seconds to minutes; this stops one that hangs. */
const timeoutMs = 30 * 60_000;

async function summarizeFile(path: string) {
  return summarizeCapture(parseCapture(await readFile(path, "utf8")));
}

type RunOptions = Extract<
  NonNullable<ReturnType<typeof parseStatementOptions>>,
  { mode: "run" }
>;

/** Runs the tests under the capture preload and saves what it recorded. */
async function capture(options: RunOptions): Promise<number> {
  const packageRoot = resolve(repositoryRoot, "packages", options.package);
  if (!(await stat(packageRoot).catch(() => null))?.isDirectory())
    throw new Error(`packages/${options.package} does not exist.`);
  const runId = crypto.randomUUID();
  const directory = await privateDirectory(reportDirectory);
  const out = resolve(directory, `statements-${runId}.jsonl`);
  const log = resolve(directory, `statements-${runId}.log`);
  const preloads = [...(await packagePreloads(packageRoot)), capturePreload];
  const { API_DATABASE: apiDatabase } = process.env;
  const result = await runTestProcess({
    cwd: packageRoot,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      ...options.files.map(testFileArgument),
      ...(options.name === null ? [] : ["-t", options.name]),
    ],
    env: {
      ...process.env,
      ...(options.package === "api" && {
        API_DATABASE: apiDatabase ?? "memory",
      }),
      PERF_STATEMENTS_OUT: out,
      PERF_STATEMENTS_PARAM_HASH: options.paramHash ? "1" : "0",
      ...(options.limit !== null && {
        PERF_STATEMENTS_LIMIT: `${options.limit}`,
      }),
    },
    log,
    timeoutMs,
  });
  const passed = result.exitCode === 0 && !result.timedOut;
  const summary = await summarizeFile(out).catch(() => null);
  const source = sourceIdentity();
  const jsonPath = await saveJson(`statements-${runId}.json`, {
    schemaVersion: 1,
    scenario: "statement-capture",
    runId,
    ...source,
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
    options,
    result,
    capture: out,
    log,
    summary,
  });
  if (!passed) console.log(await logTail(log));
  if (!summary) {
    console.log(`No statements were recorded. Test output: ${log}`);
    return 1;
  }
  const name = options.name === null ? "" : ` (-t ${options.name})`;
  const markdown = formatStatementSummary(
    summary,
    `packages/${options.package}: ${options.files.join(", ")}${name}, at \`${source.revision}\`${source.dirty ? " with uncommitted changes" : ""}.`,
  );
  const markdownPath = await saveReportFile(`statements-${runId}.md`, markdown);
  console.log(markdown);
  console.log(
    `Capture: ${out}\nReport: ${jsonPath}\nMarkdown: ${markdownPath}\nTest output: ${log}`,
  );
  return passed ? 0 : 1;
}

async function main(): Promise<number> {
  const options = parseStatementOptions(process.argv.slice(2));
  if (!options) {
    console.log(statementUsage);
    return 0;
  }
  if (options.mode === "run") return capture(options);
  const path = resolve(repositoryRoot, options.capture);
  console.log(
    formatStatementSummary(await summarizeFile(path), `Capture ${path}.`),
  );
  return 0;
}

try {
  process.exit(await main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
