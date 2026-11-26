import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface TestProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly wallMs: number;
}

/**
 * Runs `bun test` with `args` in `cwd`, writing its output to `log`,
 * owner-only, and killing it after `timeoutMs`.
 */
export async function runTestProcess(input: {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: string;
  readonly timeoutMs: number;
}): Promise<TestProcessResult> {
  const descriptor = openSync(input.log, "w", 0o600);
  const started = performance.now();
  let timedOut = false;
  let exitCode: number | null;
  try {
    const child = Bun.spawn([process.execPath, "test", ...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: descriptor,
      stderr: descriptor,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    try {
      exitCode = await child.exited;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    closeSync(descriptor);
  }
  return {
    exitCode,
    timedOut,
    wallMs: Math.round(performance.now() - started),
  };
}

/** A test file argument Bun reads as a path rather than a name filter. */
export function testFileArgument(file: string): string {
  return file.startsWith("./") || file.startsWith("/") ? file : `./${file}`;
}

/**
 * The preloads a package's `bunfig.toml` names for `bun test`. Passing any
 * `--preload` on the command line replaces them, so a caller adding one
 * names these first.
 */
export async function packagePreloads(packageRoot: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(resolve(packageRoot, "bunfig.toml"), "utf8");
  } catch {
    return [];
  }
  const config: unknown = Bun.TOML.parse(text);
  const test: unknown =
    typeof config === "object" && config !== null
      ? Reflect.get(config, "test")
      : undefined;
  const preload: unknown =
    typeof test === "object" && test !== null
      ? Reflect.get(test, "preload")
      : undefined;
  if (preload === undefined) return [];
  const list = typeof preload === "string" ? [preload] : preload;
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string"))
    throw new Error(`${packageRoot}/bunfig.toml has an unreadable preload.`);
  return list;
}

/** The last lines of a log, for the terminal. */
export async function logTail(log: string, lines = 15): Promise<string> {
  const text = await readFile(log, "utf8");
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}
