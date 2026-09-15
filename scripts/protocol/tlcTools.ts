/**
 * Shared TLC invocation for the protocol trace tooling: resolves the
 * mise-pinned Java and TLA+ tools, verifies the jar against the pin in
 * scripts/checks/tlaToolsPin.sh, and runs one bounded TLC check with an
 * isolated state directory.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

export function runTlc(
  tools: TlcTools,
  input: {
    readonly configPath: string;
    readonly cwd: string;
    readonly libraryPath?: string;
    readonly modulePath: string;
  },
): TlcRunResult {
  const stateDirectory = mkdtempSync(join(tmpdir(), "tearleads-tlc-"));
  try {
    const result = spawnSync(
      tools.javaBin,
      [
        "-XX:+UseParallelGC",
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
      ],
      { cwd: input.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    return {
      ok:
        result.status === 0 &&
        output.includes("Model checking completed. No error"),
      output,
    };
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
}
