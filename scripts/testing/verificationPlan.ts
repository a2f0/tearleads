import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VerificationStep {
  name: string;
  command: string[];
}

export interface VerificationPlan {
  mode: "full" | "affected" | "package";
  packageName: string | null;
  steps: VerificationStep[];
}

export const verificationUsage = [
  "Usage: bun run check | bun run check:affected",
  "       bun run check:package <workspace-name> [test arguments...]",
].join("\n");

export function verificationPlan(
  root: string,
  args: readonly string[],
): VerificationPlan {
  const [mode, packageName, ...testArgs] = args;
  const build = { name: "build", command: ["bun", "run", "build:packages"] };
  if (mode === "package") {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { workspaces: string[] };
    for (const path of manifest.workspaces) {
      const workspace = JSON.parse(
        readFileSync(join(root, path, "package.json"), "utf8"),
      ) as { name: string; scripts?: { test?: string } };
      if (workspace.name !== packageName) continue;
      if (!workspace.scripts?.test) {
        throw new Error(`Workspace ${packageName} has no test script`);
      }
      return {
        mode,
        packageName,
        steps: [
          build,
          {
            name: "tests",
            command: [
              "bun",
              "run",
              "--cwd",
              path,
              "test",
              ...(testArgs[0] === "--" ? testArgs.slice(1) : testArgs),
            ],
          },
        ],
      };
    }
    throw new Error(`Unknown workspace: ${packageName ?? "(missing)"}`);
  }
  if ((mode !== "full" && mode !== "affected") || args.length !== 1) {
    throw new Error(verificationUsage);
  }
  return {
    mode,
    packageName: null,
    steps: [
      build,
      {
        name: "typescript",
        command: ["bun", "tsc", "--build", "--pretty", "false"],
      },
      { name: "static", command: ["bun", "run", "check:fast"] },
      {
        name: "tests",
        command: [
          "bun",
          "run",
          mode === "full" ? "test:turbo" : "test:turbo:affected",
        ],
      },
    ],
  };
}
