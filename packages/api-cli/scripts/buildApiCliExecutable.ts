import { fileURLToPath } from "node:url";
import { Glob } from "bun";
import { migrationAssetPatterns } from "../src/migrationAssets";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
process.chdir(repoRoot);

const supportedCompileTargets: readonly string[] = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-aarch64",
];

function isSupportedCompileTarget(
  value: string,
): value is Bun.Build.CompileTarget {
  return supportedCompileTargets.includes(value);
}

function readExecutableTarget(): Bun.Build.CompileTarget {
  const { BUN_COMPILE_TARGET: envTarget } = process.env;
  const value = envTarget ?? "bun-linux-x64";
  if (isSupportedCompileTarget(value)) {
    return value;
  }

  throw new Error(`Unsupported BUN_COMPILE_TARGET: ${value}`);
}

const executableTarget = readExecutableTarget();

const drizzleFiles = migrationAssetPatterns
  .flatMap((pattern) => Array.from(new Glob(pattern).scanSync(".")))
  .sort();

const result = await Bun.build({
  entrypoints: ["packages/api-cli/src/index.ts", ...drizzleFiles],
  compile: {
    outfile: "packages/api-cli/dist/tearleads-api-cli",
    target: executableTarget,
  },
  loader: {
    ".json": "file",
    ".sql": "file",
  },
  naming: {
    asset: "[dir]/[name].[ext]",
  },
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
