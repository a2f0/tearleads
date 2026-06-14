import { Glob } from "bun";

const repoRoot = new URL("../../..", import.meta.url);
process.chdir(repoRoot.pathname);

const drizzleFiles = [
  ...new Glob("packages/api-shared/drizzle/**/*.sql").scanSync("."),
  ...new Glob("packages/api-shared/drizzle/**/*.json").scanSync("."),
].sort();

const result = await Bun.build({
  entrypoints: ["packages/api-cli/src/index.ts", ...drizzleFiles],
  compile: {
    outfile: "packages/api-cli/dist/tearleads-api-cli",
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
