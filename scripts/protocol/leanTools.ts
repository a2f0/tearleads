/**
 * Shared Lean invocation for the proof tooling: resolves the mise-pinned or
 * explicitly installed Lean toolchain, requires `.mise.toml`,
 * formal/lean/lean-toolchain, and the toolchain itself to name one version,
 * and refuses proof escapes that `lake build --wfail` does not report.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LEAN_PROJECT = "formal/lean";

export interface LeanTools {
  readonly binDir: string;
  readonly lake: string;
}

export interface LakeRunResult {
  readonly ok: boolean;
  readonly output: string;
  readonly stdout: string;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function parseMiseLeanPin(miseConfig: string): string | undefined {
  return miseConfig.match(/^"github:leanprover\/lean4" = "([^"]+)"$/m)?.[1];
}

export function parseLeanToolchain(source: string): string | undefined {
  return source.match(/^leanprover\/lean4:v(\S+)\n?$/)?.[1];
}

export function parseLakeLeanVersion(output: string): string | undefined {
  return output.match(/\(Lean version ([^)\s]+)\)/)?.[1];
}

/**
 * Tokens that let a Lean file claim more than the kernel checked without a
 * build warning: `sorry` already fails `--wfail`, but `native_decide` trusts
 * compiled code and the rest add axioms or replace definitions. Matched
 * anywhere, comments included, so prose must not use them either.
 */
const PROOF_ESCAPE =
  /\b(sorry|admit|native_decide|axiom|implemented_by|extern|unsafe)\b/;

export function findProofEscapes(path: string, source: string): string[] {
  return source.split("\n").flatMap((line, index) => {
    const token = line.match(PROOF_ESCAPE)?.[1];
    return token ? [`${path}:${index + 1} uses \`${token}\``] : [];
  });
}

export function leanSourcePaths(root: string): string[] {
  return readdirSync(join(root, LEAN_PROJECT), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(".lean") && !path.startsWith(".lake"))
    .sort()
    .map((path) => join(LEAN_PROJECT, path));
}

export function checkProofEscapes(root: string): void {
  const findings = leanSourcePaths(root).flatMap((path) =>
    findProofEscapes(path, readFileSync(join(root, path), "utf8")),
  );
  if (findings.length > 0) {
    fail(`Lean sources use proof escapes:\n${findings.join("\n")}`);
  }
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly path?: string } = {},
): LakeRunResult {
  const { PATH = "" } = process.env;
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.path
      ? { ...process.env, PATH: `${options.path}:${PATH}` }
      : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    stdout: result.stdout ?? "",
  };
}

function checkLeanVersion(root: string, lake: string): void {
  const miseValue = parseMiseLeanPin(
    readFileSync(join(root, ".mise.toml"), "utf8"),
  );
  const toolchainValue = parseLeanToolchain(
    readFileSync(join(root, LEAN_PROJECT, "lean-toolchain"), "utf8"),
  );
  if (!miseValue || !toolchainValue) {
    fail(
      ".mise.toml and formal/lean/lean-toolchain must both pin leanprover/lean4.",
    );
  }
  if (miseValue !== toolchainValue) {
    fail(
      `.mise.toml pins Lean ${miseValue} but formal/lean/lean-toolchain pins ${toolchainValue}.`,
    );
  }
  const reported = runCommand(lake, ["--version"]);
  if (
    !reported.ok ||
    parseLakeLeanVersion(reported.output) !== toolchainValue
  ) {
    fail(`${lake} does not report the pinned Lean ${toolchainValue}.`);
  }
}

export function resolveLeanTools(root: string): LeanTools {
  const { LEAN_TOOLCHAIN_ROOT } = process.env;
  let toolchainRoot = LEAN_TOOLCHAIN_ROOT;
  if (!toolchainRoot) {
    const where = runCommand("mise", ["where", "github:leanprover/lean4"]);
    if (!where.ok) {
      fail(
        "the pinned Lean toolchain is not installed; run `mise install github:leanprover/lean4` or set LEAN_TOOLCHAIN_ROOT.",
      );
    }
    toolchainRoot = where.stdout.trim();
  }
  const binDir = join(toolchainRoot, "bin");
  const lake = join(binDir, "lake");
  checkLeanVersion(root, lake);
  return { binDir, lake };
}

export function runLake(
  root: string,
  tools: LeanTools,
  args: readonly string[],
): LakeRunResult {
  return runCommand(tools.lake, args, {
    cwd: join(root, LEAN_PROJECT),
    path: tools.binDir,
  });
}
