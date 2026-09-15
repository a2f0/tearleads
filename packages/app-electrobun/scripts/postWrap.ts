import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Hutch runs hooks in Cottontail; use Bun's Zstandard decoder without requiring
// a separate zstd installation on the release machine.
const { ELECTROBUN_OS: os } = process.env;
if (os === "macos")
  execFileSync("bun", [resolve(import.meta.dirname, "prepareMacosDmg.ts")], {
    stdio: "inherit",
  });
