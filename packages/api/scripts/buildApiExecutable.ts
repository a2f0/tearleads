import { fileURLToPath } from "node:url";

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

const result = await Bun.build({
  entrypoints: ["packages/api/src/index.ts"],
  compile: {
    outfile: "packages/api/dist/symcrypt-api",
    target: executableTarget,
  },
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
