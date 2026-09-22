/**
 * Shared TLC invocation for the protocol trace tooling: resolves the
 * mise-pinned Java and TLA+ tools, verifies the jar against the pin in
 * scripts/checks/tlaToolsPin.sh, and runs one bounded TLC check with an
 * isolated state directory.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

export interface TlcTools {
  readonly javaBin: string;
  readonly jarPath: string;
}

export interface TlcRunResult {
  readonly ok: boolean;
  readonly output: string;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function commandOutput(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`\`${command} ${args.join(" ")}\` failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function pinnedJarSha256(root: string): string {
  const pinSource = readFileSync(
    join(root, "scripts/checks/tlaToolsPin.sh"),
    "utf8",
  );
  const match = pinSource.match(
    /^(?:export )?TLA_TOOLS_JAR_SHA256_PIN=([0-9a-f]{64})$/m,
  );
  if (!match?.[1]) {
    fail("scripts/checks/tlaToolsPin.sh does not declare the jar pin.");
  }
  return match[1];
}

export function resolveTlcTools(root: string): TlcTools {
  const javaBin = commandOutput("mise", ["which", "java"]);
  const tlaToolsRoot = commandOutput("mise", [
    "where",
    "github:tlaplus/tlaplus",
  ]);
  const jarPath = join(tlaToolsRoot, "tla2tools.jar");
  const jarSha256 = createHash("sha256")
    .update(readFileSync(jarPath))
    .digest("hex");
  const pinnedSha256 = pinnedJarSha256(root);
  if (jarSha256 !== pinnedSha256) {
    fail(
      `${jarPath} sha256 ${jarSha256} does not match the pinned ${pinnedSha256}.`,
    );
  }
  return { jarPath, javaBin };
}

interface TlcRunInput {
  readonly configPath: string;
  readonly cwd: string;
  readonly libraryPath?: string;
  readonly modulePath: string;
}

/**
 * How many TLC runs a check may overlap. Shared with checkProtocolModels.sh,
 * which reads the same variable.
 */
export function tlcParallelism(): number {
  const { PROTOCOL_TLC_PARALLELISM } = process.env;
  // Unset and empty both mean the default, matching the shell's ${VAR:-2}.
  const parallelism = Number(PROTOCOL_TLC_PARALLELISM || "2");
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    fail("PROTOCOL_TLC_PARALLELISM must be a positive integer.");
  }
  return parallelism;
}

/**
 * Prepares a run's private files inside its state directory and returns the
 * JVM and TLC arguments. Two isolations keep overlapping runs independent:
 *
 * - SANY copies every standard module it resolves out of the jar to
 *   `${java.io.tmpdir}/<Module>.tla`, truncating the file on write and deleting
 *   it on exit. Runs that share a tmpdir — two workers in one check, or two
 *   checkouts pushing at once — truncate each other's copy mid-parse and fail
 *   with a spurious SANY error, so each run gets a private tmpdir.
 * - TLC resolves the machine's hostname while sizing its fingerprint set and
 *   again on close. Where that name is not in /etc/hosts (a macOS `*.local`
 *   name goes to mDNS), two JVMs resolving it at the same instant stall one of
 *   them for the resolver's 5s timeout. A private hosts file mapping the name
 *   to loopback keeps the system resolver out of every run.
 */
function prepareTlcRun(
  tools: TlcTools,
  input: TlcRunInput,
  stateDirectory: string,
): string[] {
  const javaTmpDirectory = join(stateDirectory, "java-tmp");
  mkdirSync(javaTmpDirectory);
  const hostsFile = join(stateDirectory, "hosts");
  writeFileSync(hostsFile, `127.0.0.1 ${hostname()} localhost\n`);
  return [
    "-XX:+UseParallelGC",
    `-Djava.io.tmpdir=${javaTmpDirectory}`,
    `-Djdk.net.hosts.file=${hostsFile}`,
    ...(input.libraryPath ? [`-DTLA-Library=${input.libraryPath}`] : []),
    "-jar",
    tools.jarPath,
    "-workers",
    "1",
    "-metadir",
    stateDirectory,
    "-config",
    input.configPath,
    input.modulePath,
  ];
}

function tlcResult(
  status: number | null,
  stdout: string,
  stderr: string,
): TlcRunResult {
  const output = `${stdout}${stderr}`;
  return {
    ok: status === 0 && output.includes("Model checking completed. No error"),
    output,
  };
}

export function runTlc(tools: TlcTools, input: TlcRunInput): TlcRunResult {
  const stateDirectory = mkdtempSync(join(tmpdir(), "tearleads-tlc-"));
  try {
    const result = spawnSync(
      tools.javaBin,
      prepareTlcRun(tools, input, stateDirectory),
      { cwd: input.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return tlcResult(result.status, result.stdout ?? "", result.stderr ?? "");
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
}

/** `runTlc` without blocking the event loop, so a caller can overlap runs. */
export async function runTlcAsync(
  tools: TlcTools,
  input: TlcRunInput,
): Promise<TlcRunResult> {
  const stateDirectory = mkdtempSync(join(tmpdir(), "tearleads-tlc-"));
  try {
    const child = Bun.spawn({
      cmd: [tools.javaBin, ...prepareTlcRun(tools, input, stateDirectory)],
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return tlcResult(status, stdout, stderr);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
}
