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
import {
  formatClientSqlMarkdown,
  parseClientSqlCapture,
  summarizeClientSqlCapture,
} from "./clientSqlSummary";
import { formatStatementSummary } from "./markdown";
import {
  parseStatementOptions,
  type StatementOptions,
  statementUsage,
} from "./options";
import { parseCapture, summarizeCapture } from "./summary";

const capturePreload = resolve(import.meta.dir, "capturePreload.ts");
const clientSqlPreload = resolve(import.meta.dir, "clientSqlPreload.ts");
const memoryApiPackages = new Set(["api", "bob-and-alice"]);
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

async function summarizeClientFile(path: string) {
  const capture = await readCaptureFile(path);
  return capture === null
    ? null
    : summarizeClientSqlCapture(parseClientSqlCapture(capture));
}

type RunOptions = Extract<StatementOptions, { mode: "run" }>;

function buildCaptureEnv(
  options: RunOptions,
  env: StatementHost["env"],
  out: string,
  clientOut: string | null,
): Record<string, string | undefined> {
  const {
    API_DATABASE: apiDatabase,
    PERF_CLIENT_SQL_LIMIT: _clientLimit,
    PERF_CLIENT_SQL_OUT: _clientOut,
    PERF_STATEMENTS_LIMIT: _stmtLimit,
    PERF_STATEMENTS_OUT: _stmtOut,
    PERF_STATEMENTS_PARAM_HASH: _stmtParamHash,
    ...cleanEnv
  } = env;
  return {
    ...cleanEnv,
    ...(memoryApiPackages.has(options.package) && {
      API_DATABASE: apiDatabase ?? "memory",
    }),
    PERF_STATEMENTS_OUT: out,
    PERF_STATEMENTS_PARAM_HASH: options.paramHash ? "1" : "0",
    ...(options.limit !== null && {
      PERF_STATEMENTS_LIMIT: `${options.limit}`,
    }),
    ...(clientOut !== null && {
      PERF_CLIENT_SQL_OUT: clientOut,
      ...(options.limit !== null && {
        PERF_CLIENT_SQL_LIMIT: `${options.limit}`,
      }),
    }),
  };
}

function buildCaptureMarkdown(input: {
  readonly options: RunOptions;
  readonly source: ReturnType<typeof sourceIdentity>;
  readonly summary: Awaited<ReturnType<typeof summarizeFile>>;
  readonly clientSql: Awaited<ReturnType<typeof summarizeClientFile>>;
}): string {
  const name = input.options.name === null ? "" : ` (-t ${input.options.name})`;
  const dirty = input.source.dirty ? " with uncommitted changes" : "";
  const intro = `packages/${input.options.package}: ${input.options.files.join(", ")}${name}, at \`${input.source.revision}\`${dirty}.`;
  const sections: string[] = [];
  if (input.summary) {
    sections.push(formatStatementSummary(input.summary, intro).trimEnd());
  } else {
    sections.push(
      `# Statement capture\n\n${intro}\n\nNo API ORM statements were recorded.`,
    );
  }
  if (input.clientSql) {
    sections.push(
      formatClientSqlMarkdown("Client SQLite statements", input.clientSql).join(
        "\n",
      ),
    );
  }
  return `${sections.join("\n")}\n`;
}

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
  const clientOut = options.clientStatements
    ? resolve(directory, `statements-${runId}.client-sql.jsonl`)
    : null;
  const log = resolve(directory, `statements-${runId}.log`);
  const preloads = [
    ...(await packagePreloads(packageRoot)),
    capturePreload,
    ...(clientOut ? [clientSqlPreload] : []),
  ];
  const result = await host.runTests({
    cwd: packageRoot,
    args: [
      ...preloads.flatMap((preload) => ["--preload", preload]),
      ...options.files.map(testFileArgument),
      ...(options.name === null ? [] : ["-t", options.name]),
    ],
    env: buildCaptureEnv(options, host.env, out, clientOut),
    log,
    timeoutMs,
  });
  const passed = result.exitCode === 0 && !result.timedOut;
  const [summary, clientSql] = await Promise.all([
    summarizeFile(out),
    clientOut !== null ? summarizeClientFile(clientOut) : Promise.resolve(null),
  ]);
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
      ...(clientOut !== null && { clientCapture: clientOut }),
      log,
      summary,
      ...(clientOut !== null && { clientSql }),
    },
    directory,
  );
  if (!passed) host.print(await logTail(log));
  if (!summary && !clientSql) {
    host.print(`No statements were recorded. Test output: ${log}`);
    return 1;
  }
  const markdown = buildCaptureMarkdown({
    options,
    source,
    summary,
    clientSql,
  });
  const markdownPath = await saveReportFile(
    `statements-${runId}.md`,
    markdown,
    directory,
  );
  host.print(markdown);
  const paths = [
    `Capture: ${out}`,
    ...(clientOut !== null ? [`Client capture: ${clientOut}`] : []),
    `Report: ${jsonPath}`,
    `Markdown: ${markdownPath}`,
    `Test output: ${log}`,
  ];
  host.print(paths.join("\n"));
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
