import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const appSource = resolve(root, "packages/app/src");
const hookImplementation = resolve(
  appSource,
  "providers/sdk/useRuntimeScopedMemo.ts",
);
const referencedFiles: string[] = [];

for await (const relativePath of new Bun.Glob("**/*.{ts,tsx}").scan({
  cwd: appSource,
})) {
  const path = resolve(appSource, relativePath);
  if (
    path !== hookImplementation &&
    (await Bun.file(path).text()).includes("useRuntimeScopedMemo")
  ) {
    referencedFiles.push(path);
  }
}

if (referencedFiles.length === 0) {
  console.error("No useRuntimeScopedMemo references found.");
  process.exit(1);
}

const result = Bun.spawnSync(
  [
    resolve(root, "node_modules/.bin/biome"),
    "check",
    "--error-on-warnings",
    "--config-path",
    resolve(import.meta.dir, "biomeRuntimeScopedMemo.jsonc"),
    ...referencedFiles.sort(),
  ],
  { cwd: root, stderr: "inherit", stdout: "inherit" },
);

process.exit(result.exitCode);
