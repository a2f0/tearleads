import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
process.chdir(repoRoot);

const result = await Bun.build({
  entrypoints: ["packages/api/src/index.ts"],
  compile: {
    outfile: "packages/api/dist/tearleads-api",
  },
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
