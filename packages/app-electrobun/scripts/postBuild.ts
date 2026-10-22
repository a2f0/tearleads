import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const { ELECTROBUN_BUILD_DIR: buildDir } = process.env;
if (!buildDir)
  throw new Error("Electrobun did not provide its build directory");

// Use the project's Bun for renderer bundling, independent of Hutch's runner.
// Run before Electrobun signs the app and creates DMG/update archives.
execFileSync(
  "bun",
  [resolve(import.meta.dirname, "packageElectrobunAssets.ts"), buildDir],
  { stdio: "inherit" },
);
