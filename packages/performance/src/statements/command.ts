import { stat } from "node:fs/promises";
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
import { readCaptureFile } from "./captureFile";
import { formatStatementSummary } from "./markdown";
import {
  parseStatementOptions,
  type StatementOptions,
  statementUsage,
} from "./options";
import { parseCapture, summarizeCapture } from "./summary";

const capturePreload = resolve(import.meta.dir, "capturePreload.ts");
/** A focused run takes seconds to minutes; this stops one that hangs. */
const timeoutMs = 30 * 60_000;

/** What `perf:statements` runs against; tests replace the test process. */
export interface StatementHost {
  /** The directory `--package` names a directory in. */
  readonly packagesRoot: string;
  /** Where captures, reports and test output are saved. */
  readonly reportDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runTests: typeof runTestProcess;
  readonly print: (text: string) => void;
}

const defaultHost: StatementHost = {
  packagesRoot: resolve(repositoryRoot, "packages"),
  reportDirectory,
  env: process.env,
  runTests: runTestProcess,
  print: (text) => console.log(text),
};

/** The capture's summary, or null when no capture was written. */
async function summarizeFile(path: string) {
  const capture = await readCaptureFile(path);
  return capture === null ? null : summarizeCapture(parseCapture(capture));
}

type RunOptions = Extract<StatementOptions, { mode: "run" }>;

/** Runs the tests under the capture preload and saves what it recorded. */
async function capture(
  options: RunOptions,
  host: StatementHost,
): Promise<number> {
  const packageRoot = resolve(host.packagesRoot, options.package);
  if (!(await stat(packageRoot).catch(() => null))?.isDirectory())
    throw new Error(`packages/${options.package} does not exist.`);
  const runId = crypto.randomUUID();
  const directory = await privateDirectory(host.reportDirectory);
  const out = resolve(directory, `statements-${runId}.jsonl`);
  const log = resolve(directory, `statements-${runId}.log`);
  const preloads = [...(await packagePreloads(packageRoot)), capturePreload];
  const { API_DATABASE: apiDatabase } = host.env;
  const result = await host.runTests({
    cwd: packageRoot,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      ...options.files.map(testFileArgument),
      ...(options.name === null ? [] : ["-t", options.name]),
    ],
    env: {
      ...host.env,
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
  const summary = await summarizeFile(out);
  const source = sourceIdentity();
  const jsonPath = await saveJson(
    `statements-${runId}.json`,
    {
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
    },
    directory,
  );
  if (!passed) host.print(await logTail(log));
  if (!summary) {
    host.print(`No statements were recorded. Test output: ${log}`);
    return 1;
  }
  const name = options.name === null ? "" : ` (-t ${options.name})`;
  const markdown = formatStatementSummary(
    summary,
    `packages/${options.package}: ${options.files.join(", ")}${name}, at \`${source.revision}\`${source.dirty ? " with uncommitted changes" : ""}.`,
  );
  const markdownPath = await saveReportFile(
    `statements-${runId}.md`,
    markdown,
    directory,
  );
  host.print(markdown);
  host.print(
    `Capture: ${out}\nReport: ${jsonPath}\nMarkdown: ${markdownPath}\nTest output: ${log}`,
  );
  return passed ? 0 : 1;
}

/**
 * `perf:statements`: records the statements of a package's tests, or
 * summarizes a saved capture. Exits 1 when the tests fail or record nothing.
 */
export async function runStatementCommand(
  args: string[],
  host = defaultHost,
): Promise<number> {
  const options = parseStatementOptions(args);
  if (!options) {
    host.print(statementUsage);
    return 0;
  }
  if (options.mode === "run") return capture(options, host);
  const path = resolve(repositoryRoot, options.capture);
  const summary = await summarizeFile(path);
  if (!summary) throw new Error(`There is no capture at ${path}.`);
  host.print(formatStatementSummary(summary, `Capture ${path}.`));
  return 0;
}
